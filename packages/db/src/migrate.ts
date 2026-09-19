/**
 * The migration runner.
 *
 * Plain numbered `.sql` files, applied in lexical order, each recorded once. Every file
 * is written to be idempotent on its own (`IF NOT EXISTS`, `CREATE OR REPLACE`) so a
 * partially-applied database re-runs cleanly, and the ledger below means an already-run
 * file is skipped rather than re-executed.
 *
 * No dbt, no ORM, no framework. The schema is stated once, here, in SQL.
 */

// biome-ignore-all lint/performance/noAwaitInLoops: These sequential awaits are the point. Pacing a connector against a rate limit, walking Dokploy deployment records until one settles, and migrating SQL files in order all require the previous iteration to finish first; running them concurrently is the bug this rule would introduce.
// biome-ignore-all lint/style/noContinue: Each `continue` here skips one item in a loop with a stated reason on the line above. Restructuring to avoid it means nesting the body in an `if`, which adds a level of indentation and says nothing new.
// biome-ignore-all lint/style/useDestructuring: Style preference with no correctness content, and it fires where the current form names the source of the value (`params.tenantId`), which is the thing worth seeing at the call site.
// biome-ignore-all lint/style/useExportsLast: Reordering 28 modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. The ordering carries meaning here and the rule's preferred one does not.

// biome-ignore-all lint/correctness/noNodejsModules: This is server code running on Bun. `node:` builtins are the platform here, not a portability hazard -- the rule exists for code that must also run in a browser.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SqlExecutor } from "./executor.ts";

const LEDGER = `
CREATE SCHEMA IF NOT EXISTS ops AUTHORIZATION undercroft_owner;
CREATE TABLE IF NOT EXISTS ops.schema_migration (
    name       text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);
`;

export interface Migration {
  readonly name: string;
  readonly sql: string;
}

/** The migrations shipped with the platform, in application order. */
export function loadMigrations(dir: string = defaultSqlDir()): Migration[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));
}

function defaultSqlDir(): string {
  return join(import.meta.dirname, "..", "sql");
}

export interface MigrateResult {
  readonly applied: string[];
  readonly skipped: string[];
}

/** The login roles a deploy sets a password on. Nothing else may be named to `setRolePassword`. */
export const PLATFORM_LOGIN_ROLES = ["undercroft_app", "undercroft_worker"] as const;
export type PlatformLoginRole = (typeof PLATFORM_LOGIN_ROLES)[number];

/**
 * Give a platform role the password its service will connect with.
 *
 * `001_roles.sql` creates the roles with no password and says the password is "set out of
 * band". For two releases nothing set one, so every service connected as the bootstrap
 * superuser and the whole grant model was proven in PGlite and bound nowhere. The deploy's
 * `db-migrate` step calls this with the values from its environment; see `migrateCli.ts`.
 *
 * The role is an allow-listed literal and the password is quoted as a SQL literal, because
 * `ALTER ROLE` takes neither as a bind parameter. Idempotent, like everything else this
 * runner does: setting the same password twice is a no-op.
 */
export async function setRolePassword(
  executor: SqlExecutor,
  role: PlatformLoginRole,
  password: string,
): Promise<void> {
  if (!PLATFORM_LOGIN_ROLES.includes(role)) {
    throw new Error(`refusing to set a password on ${role}: not a platform login role`);
  }
  if (password === "") {
    throw new Error(`refusing to set an empty password on ${role}`);
  }
  const literal = password.replaceAll("'", "''");
  await executor.exec(`ALTER ROLE ${role} PASSWORD '${literal}'`);
}

/**
 * Apply every pending migration. Returns what it applied and what it skipped.
 *
 * The first migration creates the roles the ledger's `AUTHORIZATION` clause needs, so it
 * is applied before the ledger can be read. Because it is idempotent, applying it on
 * every run to bootstrap the ledger is a cheap no-op after the first time; it is then
 * recorded like any other file so it is not counted as applied twice.
 */
export async function migrate(
  executor: SqlExecutor,
  migrations: Migration[] = loadMigrations(),
): Promise<MigrateResult> {
  const roles = migrations[0];
  if (roles === undefined) {
    return { applied: [], skipped: [] };
  }

  // Bootstrap: roles, then the ledger. Both are idempotent.
  await executor.exec(roles.sql);
  await executor.exec(LEDGER);

  const { rows } = await executor.query<{ name: string }>("SELECT name FROM ops.schema_migration");
  const already = new Set(rows.map((r) => r.name));

  const applied: string[] = [];
  const skipped: string[] = [];
  for (const m of migrations) {
    if (already.has(m.name)) {
      skipped.push(m.name);
      continue;
    }
    // The roles file was already exec'd above during bootstrap; every other file runs
    // here. Recording it is what keeps a second `migrate()` from re-running it.
    if (m !== roles) {
      await executor.exec(m.sql);
    }
    await executor.query("INSERT INTO ops.schema_migration (name) VALUES ($1)", [m.name]);
    applied.push(m.name);
  }
  return { applied, skipped };
}

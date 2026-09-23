/**
 * The migration runner.
 *
 * Plain numbered `.sql` files, applied in lexical order, each recorded once. Every file
 * is written to be idempotent on its own (`IF NOT EXISTS`, `CREATE OR REPLACE`) so a
 * partially-applied database re-runs cleanly, and the ledger below means an already-run
 * file is skipped rather than re-executed.
 *
 * WHY THERE IS A SECOND KIND OF FILE. The ledger keys on a file's NAME and stores no
 * checksum, so editing an applied migration reaches new databases only. For a table that is
 * harmless -- the table is already there. For a FUNCTION WHOSE BODY IS A POLICY it is a
 * silent defect: `ops.provision_tenant` decides what every tenant login may read, and its
 * grant list grew twice (ADR 0024, ADR 0026) by editing `080_tenant_isolation.sql` in place.
 * In an upgraded database that edit changed nothing, so a tenant provisioned afterwards was
 * created by the OLD body and silently lacked `raw.document_text` and the six search
 * functions. Each of those files carried a catch-up loop, which covered the tenants that
 * existed the day it ran and nothing after. It reached production, and this suite could not
 * see it: every test database is fresh, so 080's current text always applies.
 *
 * So `sql/repeatable/` holds the files that state a CURRENT DEFINITION rather than a change,
 * and they are re-applied on EVERY run, after the numbered ones. Editing one reaches every
 * database at the next deploy -- which is the one thing a numbered file cannot do. ADR 0036.
 *
 * No dbt, no ORM, no framework. The schema is stated once, here, in SQL.
 */

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

/**
 * The repeatable files, in application order.
 *
 * A file here is read exactly like a migration; what differs is the rule applied to it. It
 * must state a whole current definition with `CREATE OR REPLACE`, because it runs again on
 * every deploy -- a file that CREATEs a table or inserts a row does not belong here.
 */
export function loadRepeatables(dir: string = defaultRepeatableDir()): Migration[] {
  return loadMigrations(dir);
}

function defaultSqlDir(): string {
  return join(import.meta.dirname, "..", "sql");
}

function defaultRepeatableDir(): string {
  return join(defaultSqlDir(), "repeatable");
}

export interface MigrateResult {
  readonly applied: string[];
  readonly skipped: string[];
  /** The repeatable files, which run every time. Never empty on a successful run. */
  readonly repeated: string[];
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
  repeatables: Migration[] = loadRepeatables(),
): Promise<MigrateResult> {
  const [roles] = migrations;
  if (roles === undefined) {
    return { applied: [], skipped: [], repeated: [] };
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

  // After every numbered file, never before: a repeatable definition may reference anything
  // the schema has by the end. `ops.provision_tenant` grants on `raw.document_text` and the
  // search functions, which 180 and 190 create.
  //
  // Not recorded in the ledger, deliberately -- the ledger's whole job is to say what has
  // already run, and the answer for these is "it runs again".
  const repeated: string[] = [];
  for (const r of repeatables) {
    await executor.exec(r.sql);
    repeated.push(r.name);
  }
  return { applied, skipped, repeated };
}

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

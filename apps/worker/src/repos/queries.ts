/**
 * Running SQL an author wrote, AS the tenant's read-only login, inside a frame it cannot
 * leave.
 *
 * The frame is four statements around the author's one. A read-only transaction, so a
 * write is refused by Postgres before any grant is consulted; a statement timeout local to
 * the transaction, so a runaway join is cut rather than holding the box; a `search_path`
 * of the tenant's own analytics schema, so `stg_deals` means theirs and nobody else's; and
 * the author's SELECT as a sub-select under our own LIMIT. It goes through the extended
 * protocol with an empty parameter list, which is what makes a second statement -- the
 * `; DROP TABLE` after a SELECT -- a syntax error rather than a second statement.
 *
 * Every statement here runs on an executor that already IS the login (see
 * `services/tenantSession.ts`); this module decides nothing about who may read what.
 */

import type { QueryField, SqlExecutor } from "@undercroft/db";

export interface Framed {
  readonly rows: Record<string, unknown>[];
  readonly fields: readonly QueryField[];
}

const TRAILING_SEMICOLONS = /;+\s*$/u;

/** A trailing semicolon, and whitespace around the whole. What an editor leaves behind. */
function trimSql(sql: string): string {
  return sql.trim().replace(TRAILING_SEMICOLONS, "");
}

/**
 * Run the author's SELECT inside the frame and give back up to `limit + 1` rows, so the
 * caller can say the page was cut rather than guess from a full one.
 *
 * Always rolled back: nothing a read-only transaction did needs keeping, and a ROLLBACK
 * after a failed statement is what returns the connection to a usable state.
 */
export function runFramed(
  exec: SqlExecutor,
  frame: { schema: string; sql: string; limit: number; offset?: number; timeoutMs: number },
): Promise<Framed> {
  return inReadOnlyTransaction(exec, frame, async () => {
    // The limit is an integer we validated, spliced rather than bound so that the author's
    // own `$1`, if any, is not silently satisfied by it. The empty parameter list keeps the
    // extended protocol, which refuses a second statement.
    const result = await exec.query<Record<string, unknown>>(
      // Both numbers are integers this module validated, spliced rather than bound so the
      // author's own `$1`, if any, is not silently satisfied by one of them. The empty
      // parameter list keeps the extended protocol, which refuses a second statement.
      `SELECT * FROM (\n${trimSql(frame.sql)}\n) AS _q LIMIT ${String(frame.limit + 1)} OFFSET ${String(Math.trunc(frame.offset ?? 0))}`,
      [],
    );
    return { rows: result.rows, fields: result.fields ?? [] };
  });
}

/**
 * The frame itself, without an opinion about what runs inside it.
 *
 * Shared rather than copied because it is a SECURITY boundary and not a convenience: a second
 * spelling of it somewhere else is a second place for `SET TRANSACTION READ ONLY` to be left
 * out, and the symptom of leaving it out is a tenant's dbt login -- which CAN create in its own
 * two schemas -- running whatever it was handed. `searchLake` is the other caller; it passes no
 * `schema` because it names its tables in full, and an unqualified name in OUR SQL resolving
 * somewhere unexpected is not a hazard this repo has.
 *
 * Always rolled back: nothing a read-only transaction did needs keeping, and a ROLLBACK after a
 * failed statement is what returns the connection to a usable state.
 */
export async function inReadOnlyTransaction<T>(
  exec: SqlExecutor,
  frame: { schema?: string; timeoutMs: number },
  fn: () => Promise<T>,
): Promise<T> {
  await exec.query("BEGIN");
  try {
    await exec.query("SET TRANSACTION READ ONLY");
    await exec.query("SELECT set_config('statement_timeout', $1, true)", [String(frame.timeoutMs)]);
    if (frame.schema !== undefined) {
      await exec.query("SELECT set_config('search_path', $1, true)", [frame.schema]);
    }
    return await fn();
  } finally {
    await exec.query("ROLLBACK");
  }
}

/** Postgres's own name for each type OID: `numeric`, `integer`, `timestamp with time zone`. */
export async function typeNames(
  exec: SqlExecutor,
  oids: readonly number[],
): Promise<Map<number, string>> {
  const names = new Map<number, string>();
  if (oids.length === 0) {
    return names;
  }
  const { rows } = await exec.query<{ oid: number; name: string }>(
    "SELECT oid::int AS oid, format_type(oid, NULL) AS name FROM pg_type WHERE oid = ANY($1::oid[])",
    [oids],
  );
  for (const row of rows) {
    names.set(row.oid, row.name);
  }
  return names;
}

export interface SchemaColumn {
  readonly table_name: string;
  readonly column_name: string;
  readonly data_type: string;
}

/** Every column of every table the login can see in `schema`, in table and column order. */
export async function schemaColumns(exec: SqlExecutor, schema: string): Promise<SchemaColumn[]> {
  const { rows } = await exec.query<SchemaColumn>(
    `SELECT table_name, column_name, data_type FROM information_schema.columns
     WHERE table_schema = $1
     ORDER BY table_name, ordinal_position`,
    [schema],
  );
  return rows;
}

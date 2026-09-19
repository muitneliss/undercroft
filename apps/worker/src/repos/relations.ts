/**
 * Reading a relation AS a tenant: its columns, and its first rows.
 *
 * Every statement here runs on an executor that is already the tenant's own login (see
 * `services/tenantSession.ts`), so what it can see is what Postgres lets that login see and
 * nothing this module decides. Identifiers are quoted, never interpolated bare: a model name
 * has passed the contract's rule before it is a row, but a relation dbt named for a test is
 * dbt's to spell.
 */

// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys, HTTP header names, and Better Auth's option keys and table names. strictCase cannot be satisfied by code that talks to another system.

import type { SqlExecutor } from "@undercroft/db";

export interface Column {
  readonly name: string;
  /** Postgres's own name for the type: `numeric`, `integer`, `text`, `timestamp with time zone`. */
  readonly type: string;
}

/** `"name"`, with any quote in the name doubled. The only safe way to splice an identifier. */
export function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** The relation's columns in table order, or none when the login cannot see such a relation. */
export async function columnsOf(
  exec: SqlExecutor,
  schema: string,
  relation: string,
): Promise<Column[]> {
  const { rows } = await exec.query<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2
     ORDER BY ordinal_position`,
    [schema, relation],
  );
  return rows.map((r) => ({ name: r.column_name, type: r.data_type }));
}

/**
 * The first `limit + 1` rows, as arrays in `columns` order. One more than asked, so the
 * caller can say the page was cut rather than guess from a full one.
 */
export async function firstRows(
  exec: SqlExecutor,
  target: { schema: string; relation: string; columns: readonly Column[]; limit: number },
): Promise<unknown[][]> {
  if (target.columns.length === 0) {
    return [];
  }
  const list = target.columns.map((c) => quoteIdent(c.name)).join(", ");
  const from = `${quoteIdent(target.schema)}.${quoteIdent(target.relation)}`;
  const { rows } = await exec.query<Record<string, unknown>>(
    `SELECT ${list} FROM ${from} LIMIT $1`,
    [target.limit + 1],
  );
  return rows.map((row) => target.columns.map((c) => row[c.name]));
}

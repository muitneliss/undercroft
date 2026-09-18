/**
 * A peek at an `analytics` table, for the UI.
 *
 * The one place in the codebase where a table NAME comes from a request, because dbt models
 * are user-authored and their names cannot be known here. A name cannot be a bind parameter,
 * so it is interpolated -- and the identifier check therefore lives in this file, next to
 * the interpolation it protects, not only on the handler's input schema. Two checks for one
 * hazard is the intent: the outer one gives a caller a 400, and this one holds even if some
 * future caller forgets it.
 *
 * Money-shaped columns come back as strings, never numbers: `pinTypeParsers` pins `numeric`
 * and `int8` to text, so a `numeric(18,4)` never passes through a float on its way to a
 * dashboard. `.claude/rules/money.md`.
 */

import type { SqlExecutor } from "@undercroft/db";

/** dbt model names are lowercase snake_case. Anything else is not an identifier we made. */
const IDENTIFIER = /^[a-z][a-z0-9_]*$/;

const PREVIEW_ROWS = 50;

export async function previewTable(
  exec: SqlExecutor,
  table: string,
): Promise<Record<string, unknown>[]> {
  if (!IDENTIFIER.test(table)) {
    // Unreachable through the API -- the handler's schema rejects it first. Reached only by
    // a new caller that skipped validation, and then it must stop here rather than compose
    // a statement out of whatever it was handed.
    throw new Error(`${JSON.stringify(table)} is not a valid analytics table name`);
  }
  const { rows } = await exec.query<Record<string, unknown>>(
    `SELECT * FROM analytics.${table} LIMIT ${String(PREVIEW_ROWS)}`,
  );
  return rows;
}

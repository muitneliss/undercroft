/**
 * A schema answer cut down to the tables a reader named: the one rule `bi.schema` and
 * `lake.querySchema` share (issue 443, ADR 0125).
 *
 * The worker still reads the whole schema -- one catalogue query, cheap -- and the narrowing
 * happens here, after it, so the worker's contract stays one shape and both doors narrow by
 * the same rule. What was expensive was never the read; it was 164 KB of every column of 191
 * tables arriving at a client that wanted three of them.
 *
 * **Every filter narrows; none guesses.** A name in `tables` that the schema does not hold is
 * refused with the names it lacks, rather than left out of a shorter answer: three tables asked
 * for and two returned reads as "the third has no columns" or "the third is there", and an
 * author writes a model against it either way. `match` is a plain substring, case-insensitive,
 * because a reader types a fragment of a name -- a pattern language would be one more thing to
 * get subtly wrong, and a regex from a caller is one more thing to run.
 *
 * **Names alone say so.** `columns: false` answers `{ columns: false, tables: [{ name }] }`: a
 * table with no `columns` key, and the answer marked at the top. An empty `columns` array
 * would read as a table that has none.
 */

import type { SchemaResponse } from "@undercroft/contracts";

import { narrowByName } from "./listFilter.ts";
import type { WorkerOutcome } from "./workerClient.ts";

/** The most table names one read may name. A reader naming more wants the whole schema. */
export const MAX_SCHEMA_TABLES = 100;

/** What a reader asked to see of a schema. Each field is optional and only ever narrows. */
export interface SchemaFilter {
  /** Exactly these tables, by name. */
  readonly tables?: readonly string[] | undefined;
  /** Tables whose name contains this, compared case-insensitively. */
  readonly match?: string | undefined;
  /** `false` for table names alone. Defaults to `true`. */
  readonly columns?: boolean | undefined;
}

/** The answer to a names-only read: no table carries a `columns` key, and the answer says so. */
export interface TableNames {
  readonly columns: false;
  readonly tables: readonly { readonly name: string }[];
}

export type SchemaAnswer = SchemaResponse | TableNames;

export type NarrowedSchema =
  | { readonly ok: true; readonly value: SchemaAnswer }
  /** The names in `tables` the schema does not hold, in the order they were asked for. */
  | { readonly ok: false; readonly missing: readonly string[] };

/**
 * The schema with only the tables the filter admits, in the schema's own order. With no
 * filter at all it is the schema, unchanged.
 */
export function narrowSchema(schema: SchemaResponse, filter: SchemaFilter): NarrowedSchema {
  const narrowed = narrowByName(schema.tables, (table) => table.name, {
    names: filter.tables,
    match: filter.match,
  });
  if (!narrowed.ok) {
    return narrowed;
  }
  const tables = narrowed.items;
  if (filter.columns === false) {
    return { ok: true, value: { columns: false, tables: tables.map(({ name }) => ({ name })) } };
  }
  return { ok: true, value: { tables } };
}

/** A schema read through the worker and narrowed, or why it was not answered. */
export type SchemaOutcome =
  | WorkerOutcome<SchemaAnswer>
  | { readonly ok: false; readonly reason: "unknown-tables"; readonly missing: readonly string[] };

/** Read a schema with `read`, then narrow it by `filter`. A worker that did not answer, says so. */
export async function readSchema(
  read: () => Promise<WorkerOutcome<SchemaResponse>>,
  filter: SchemaFilter,
): Promise<SchemaOutcome> {
  const outcome = await read();
  if (!outcome.ok) {
    return outcome;
  }
  const narrowed = narrowSchema(outcome.value, filter);
  return narrowed.ok
    ? narrowed
    : { ok: false, reason: "unknown-tables", missing: narrowed.missing };
}

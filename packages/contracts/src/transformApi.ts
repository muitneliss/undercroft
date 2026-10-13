/**
 * The worker's transform verbs as the control plane calls them: build some models and read
 * what they hold, and read the rows a failed test stored.
 *
 * `TableResult` is the one shape every tenant-scoped read answers with, here and later for
 * the query runner: columns with their Postgres type names, rows as arrays in column order,
 * and whether the page was cut. A `numeric` or `bigint` cell is a STRING -- the pinned
 * parsers in `@undercroft/db` keep money out of floats, and this shape carries that all the
 * way to the browser -- while `integer`, `real` and `boolean` arrive as themselves.
 */

import { z } from "zod";

import { MAX_BUILD_SELECTORS, ModelName, ModelSelector } from "./models.ts";

export const Cell = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type Cell = z.infer<typeof Cell>;

export const TableResult = z.object({
  columns: z.array(z.object({ name: z.string(), type: z.string() })),
  rows: z.array(z.array(Cell)),
  /** More rows exist than were returned. */
  truncated: z.boolean(),
});
export type TableResult = z.infer<typeof TableResult>;

/** The Postgres types whose cells are figures: an exact decimal string, or a JSON number. */
const NUMERIC_TYPES: ReadonlySet<string> = new Set([
  "numeric",
  "bigint",
  "integer",
  "smallint",
  "real",
  "double precision",
]);

/**
 * Whether a column of this Postgres type holds figures. Read by the chart, which may plot it,
 * and by the CSV encoder, which keeps its plain numbers' signs (`csv.ts`).
 */
export function isNumericType(pgType: string): boolean {
  return NUMERIC_TYPES.has(pgType);
}

/** The most rows a preview or a failing-rows read returns. A look, not an export. */
export const MAX_PREVIEW_ROWS = 50;

export const RunStepShape = z.object({
  uniqueId: z.string(),
  kind: z.enum(["model", "test"]),
  name: z.string(),
  status: z.string(),
  failures: z.number().int().nullable(),
  relation: z.string().nullable(),
  message: z.string().nullable(),
  executionMs: z.number().int().nullable(),
});

/**
 * Build some of a tenant's models as one run: one `dbt build` over the union of `select`.
 *
 * `model` is the one-model request a control plane older than `select` sends. The two deploy
 * separately, so for a while each may be answered by the other's previous build: the worker
 * reads `model` as a selection of that one model, and a control plane sends it beside `select`
 * whenever the selection is exactly one model, so an older worker builds the same thing. A
 * selection of several is never narrowed to one for an older worker -- that would be a build of
 * less than was asked, answered as if it were all of it -- and an older worker refuses it.
 *
 * With `wait` false the worker answers as soon as the run is open (202, {@link BuildStarted}),
 * and the build goes on exactly as it would have: the same turn, the same deadline, the same
 * lock. Who asked then waits on the run itself (`runs.get` with `waitSeconds`).
 */
export const BuildModelRequest = z.object({
  tenantId: z.string().min(1),
  select: z.array(ModelSelector).min(1).max(MAX_BUILD_SELECTORS).optional(),
  model: ModelName.optional(),
  wait: z.boolean().default(true),
  /** An `app_user` uuid, never an address: `ops.run` is readable by the BI role. */
  triggeredBy: z.string().default(""),
});
export type BuildModelRequest = z.infer<typeof BuildModelRequest>;

/** What a request asks to build: its `select`, else its one `model`, else nothing it can run. */
export function buildSelection(request: BuildModelRequest): ModelSelector[] | null {
  if (request.select !== undefined) {
    return request.select;
  }
  return request.model === undefined ? null : [request.model];
}

/** A build not waited for: the run that is doing it. */
export const BuildStarted = z.object({ runId: z.string() });
export type BuildStarted = z.infer<typeof BuildStarted>;

/**
 * How many rows a named model's table holds after this build, as the tenant's BI login counts
 * them. `null` when there is no count to give: the model did not build in this run (its table,
 * if any, is an earlier build's, and counting it would date an old figure to now), or the count
 * could not be read in time. Never `0` for either -- an empty table is the only zero.
 */
export const ModelRowCount = z.object({ name: ModelName, rows: z.number().int().nullable() });
export type ModelRowCount = z.infer<typeof ModelRowCount>;

export const BuildModelResponse = z.object({
  runId: z.string(),
  ok: z.boolean(),
  testsFailed: z.number().int(),
  error: z.string().nullable(),
  steps: z.array(RunStepShape),
  /**
   * One per model the selection names, in the order named -- not the upstream or downstream a
   * `+` adds, which a caller did not name and can read from `steps`. Empty from a worker older
   * than the count, which a reader takes for "not counted", never for "no rows".
   */
  rowCounts: z.array(ModelRowCount).default([]),
  /**
   * The first rows of the one model a selection names, once this build has built it; null when
   * it did not build, or when the selection names several -- a page of each is a page nobody
   * asked for, and the counts say how much each holds.
   */
  preview: TableResult.nullable(),
});
export type BuildModelResponse = z.infer<typeof BuildModelResponse>;

/**
 * Drop what a model's builds left in the tenant's schemas, before its row is deleted.
 *
 * The worker answers with every relation it dropped, which is empty for a model that was
 * never built -- a real answer, not a missing one. It refuses rather than drops while a build
 * of the tenant is running (409 `run_in_progress`), and while a relation another model owns
 * reads from one of them (409 `relation_depended_on`, the dependents' names in `details`).
 * ADR 0077.
 */
export const DropModelRequest = z.object({
  tenantId: z.string().min(1),
  model: ModelName,
});
export type DropModelRequest = z.infer<typeof DropModelRequest>;

export const DroppedRelation = z.object({
  schema: z.string(),
  name: z.string(),
  kind: z.enum(["table", "view", "materialized view"]),
});
export type DroppedRelation = z.infer<typeof DroppedRelation>;

export const DropModelResponse = z.object({ dropped: z.array(DroppedRelation) });
export type DropModelResponse = z.infer<typeof DropModelResponse>;

export const DqFailuresRequest = z.object({
  tenantId: z.string().min(1),
  runId: z.string().min(1),
  uniqueId: z.string().min(1),
  limit: z.number().int().min(1).max(MAX_PREVIEW_ROWS).default(MAX_PREVIEW_ROWS),
});
export type DqFailuresRequest = z.infer<typeof DqFailuresRequest>;

/** The most rows one query answers with. A chart or a table, not an export. */
export const MAX_QUERY_ROWS = 5000;
/** What a question gets when it does not say. */
export const DEFAULT_QUERY_ROWS = 1000;
/** The longest SQL one question may hold. */
export const MAX_QUERY_SQL_BYTES = 64 * 1024;

/**
 * Run one SELECT as the tenant's read-only login. The runner wraps it in a sub-select with
 * its own LIMIT inside a read-only transaction; the SQL is the author's and is executed
 * verbatim within that frame.
 */
export const RunQueryRequest = z.object({
  tenantId: z.string().min(1),
  sql: z.string().min(1).max(MAX_QUERY_SQL_BYTES),
  limit: z.number().int().min(1).max(MAX_QUERY_ROWS).default(DEFAULT_QUERY_ROWS),
  /**
   * Rows to skip, so a console can page without the author writing OFFSET themselves.
   *
   * Paging a query that names no ORDER BY is not stable -- Postgres may return a row on two
   * pages or on neither, because without an order there is nothing for OFFSET to count
   * against. That is a property of SQL rather than of this field, so it is not forbidden
   * here; the console says so on screen when the author's SQL has no ORDER BY.
   */
  offset: z.number().int().min(0).default(0),
});
export type RunQueryRequest = z.infer<typeof RunQueryRequest>;

/**
 * Stream every row one SELECT answers, as CSV, as the tenant's read-only login (ADR 0111).
 *
 * The same frame as `RunQueryRequest` with no LIMIT and no OFFSET: the rows come through one
 * cursor in one read-only transaction, so an export of any length is one consistent snapshot
 * rather than pages that a concurrent build could shift between. There is no `limit` because
 * an export is the whole answer; a builder question still carries its own `LIMIT` in its SQL.
 */
export const ExportQueryRequest = z.object({
  tenantId: z.string().min(1),
  sql: z.string().min(1).max(MAX_QUERY_SQL_BYTES),
});
export type ExportQueryRequest = z.infer<typeof ExportQueryRequest>;

/** The tenant's analytics schema as its read-only login sees it: every table, every column. */
export const SchemaResponse = z.object({
  tables: z.array(
    z.object({
      name: z.string(),
      columns: z.array(z.object({ name: z.string(), type: z.string() })),
    }),
  ),
});
export type SchemaResponse = z.infer<typeof SchemaResponse>;

/**
 * The worker's transform verbs as the control plane calls them: build one model and read
 * its first rows, and read the rows a failed test stored.
 *
 * `TableResult` is the one shape every tenant-scoped read answers with, here and later for
 * the query runner: columns with their Postgres type names, rows as arrays in column order,
 * and whether the page was cut. A `numeric` or `bigint` cell is a STRING -- the pinned
 * parsers in `@undercroft/db` keep money out of floats, and this shape carries that all the
 * way to the browser -- while `integer`, `real` and `boolean` arrive as themselves.
 */

import { z } from "zod";

import { ModelName } from "./models.ts";

export const Cell = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type Cell = z.infer<typeof Cell>;

export const TableResult = z.object({
  columns: z.array(z.object({ name: z.string(), type: z.string() })),
  rows: z.array(z.array(Cell)),
  /** More rows exist than were returned. */
  truncated: z.boolean(),
});
export type TableResult = z.infer<typeof TableResult>;

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

export const BuildModelRequest = z.object({
  tenantId: z.string().min(1),
  model: ModelName,
  /** An `app_user` uuid, never an address: `ops.run` is readable by the BI role. */
  triggeredBy: z.string().default(""),
});
export type BuildModelRequest = z.infer<typeof BuildModelRequest>;

export const BuildModelResponse = z.object({
  runId: z.string(),
  ok: z.boolean(),
  testsFailed: z.number().int(),
  error: z.string().nullable(),
  steps: z.array(RunStepShape),
  /** The model's first rows after a successful build; null when the build failed. */
  preview: TableResult.nullable(),
});
export type BuildModelResponse = z.infer<typeof BuildModelResponse>;

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
});
export type RunQueryRequest = z.infer<typeof RunQueryRequest>;

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

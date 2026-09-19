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

// biome-ignore-all lint/style/useExportsLast: Reordering 28 modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. The ordering carries meaning here and the rule's preferred one does not.

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

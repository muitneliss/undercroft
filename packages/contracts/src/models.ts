/**
 * What a customer-authored dbt model is allowed to be.
 *
 * The name is dbt's relation name and a Postgres identifier at once, so it is a plain
 * lowercase identifier and nothing else: `stg_deals`, never `Deals` or `1x` or `a-b`. The
 * tests are the two dbt generic tests a form can offer per column -- `not_null` and
 * `unique` -- keyed by column name under the same identifier rule, and the shape is what
 * `app.model.tests` stores and what the worker turns into `schema.yml`.
 *
 * Shared by the control plane (which validates a save), the worker (which writes the
 * project) and the browser (which refuses a bad name before it is sent).
 */

import { z } from "zod";

/** A dbt model or column name: what Postgres accepts unquoted and dbt accepts as a node. */
export const MODEL_NAME = /^[a-z][a-z0-9_]*$/u;

/** NAMEDATALEN - 1: the longest identifier Postgres keeps whole. */
export const MAX_IDENTIFIER_CHARS = 63;

export const ModelName = z.string().regex(MODEL_NAME).max(MAX_IDENTIFIER_CHARS);
export type ModelName = z.infer<typeof ModelName>;

/**
 * One model to build, as dbt selects it: `stg_deals` (the model), `+stg_deals` (it and every
 * model upstream of it) or `stg_deals+` (it and every model downstream). Nothing else of dbt's
 * selector grammar -- no `tag:`, no `path:`, no `@`, no wildcard -- because each of those reaches
 * further than a person can read off the names, and because the name inside is checked to be a
 * model of the tenant before dbt runs: a selector that matches nothing is a dbt build that
 * succeeds having built nothing, which is the answer this refuses to give (issue 442).
 *
 * The regex is the whole guard on what reaches dbt's argv: one optional `+` on one side of a
 * plain identifier, so no selector can be read as a flag or split into two.
 */
const MODEL_SELECTOR = /^(?:\+?[a-z][a-z0-9_]*|[a-z][a-z0-9_]*\+)$/u;

export const ModelSelector = z
  .string()
  .regex(MODEL_SELECTOR)
  // The identifier inside keeps Postgres's limit; the one `+` is the only character beyond it.
  .max(MAX_IDENTIFIER_CHARS + 1);
export type ModelSelector = z.infer<typeof ModelSelector>;

/** The most selectors one build takes: a handful of related models, not the whole project. */
export const MAX_BUILD_SELECTORS = 20;

/** The model a selector names, without its `+`: `+stg_deals` and `stg_deals+` are `stg_deals`. */
export function selectedModel(selector: ModelSelector): ModelName {
  return selector.replaceAll("+", "");
}

export const TEST_KINDS = ["not_null", "unique"] as const;
export const TestKind = z.enum(TEST_KINDS);
export type TestKind = z.infer<typeof TestKind>;

/** `{"columns": {"deal_id": ["not_null", "unique"]}}`. Empty is a model with no tests. */
export const ModelTests = z.object({
  columns: z.record(ModelName, z.array(TestKind).max(TEST_KINDS.length)).default({}),
});
export type ModelTests = z.infer<typeof ModelTests>;

/** The most SQL one model may hold. A model is a projection, not a data file. */
export const MAX_MODEL_SQL_BYTES = 64 * 1024;

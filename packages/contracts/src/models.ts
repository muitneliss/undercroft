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

// biome-ignore-all lint/style/noMagicNumbers: The size cap is the one number in the file, written as the kilobytes it is rather than as a constant that says the same thing twice.
// biome-ignore-all lint/style/useExportsLast: Reordering 28 modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. The ordering carries meaning here and the rule's preferred one does not.
// biome-ignore-all lint/style/useNamingConvention: `not_null` is dbt's own name for the test, and the value stored and sent over the wire; a camelCase spelling would be a second name for the same thing.

import { z } from "zod";

/** A dbt model or column name: what Postgres accepts unquoted and dbt accepts as a node. */
export const MODEL_NAME = /^[a-z][a-z0-9_]*$/u;

/** NAMEDATALEN - 1: the longest identifier Postgres keeps whole. */
export const MAX_IDENTIFIER_CHARS = 63;

export const ModelName = z.string().regex(MODEL_NAME).max(MAX_IDENTIFIER_CHARS);
export type ModelName = z.infer<typeof ModelName>;

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

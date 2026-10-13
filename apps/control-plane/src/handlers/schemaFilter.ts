/**
 * What `bi.schema` and `lake.querySchema` take besides the tenant, and what their refusal of
 * an unknown table means over HTTP -- written once, because the two must not drift into
 * narrowing by different rules. The narrowing itself is `services/tableSchema.ts`.
 */

import type { Locale } from "@undercroft/core";
import { z } from "zod";

import { messages } from "../i18n/index.ts";
import {
  MAX_SCHEMA_TABLES,
  type SchemaAnswer,
  type SchemaOutcome,
} from "../services/tableSchema.ts";
import { notRun } from "./answers.ts";
import { refusal } from "./trpc.ts";

/** Postgres's identifier limit is 63 bytes; a name past this is no table's. */
const MAX_TABLE_NAME_CHARS = 128;

/** Every field optional: with none, the whole schema, exactly as before issue 443. */
export const SchemaFilterInput = z.object({
  tables: z
    .array(z.string().min(1).max(MAX_TABLE_NAME_CHARS))
    .min(1)
    .max(MAX_SCHEMA_TABLES)
    .optional(),
  match: z.string().min(1).max(MAX_TABLE_NAME_CHARS).optional(),
  columns: z.boolean().default(true),
});

/**
 * The schema the outcome carries, or the refusal it means. An unknown table is NOT_FOUND
 * naming every missing one, comma-joined in `details.tables`, so an agent can correct the
 * names it guessed in one step rather than one per retry.
 */
export function schemaOrRefusal(locale: Locale, outcome: SchemaOutcome): SchemaAnswer {
  if (outcome.ok) {
    return outcome.value;
  }
  if (outcome.reason === "unknown-tables") {
    const tables = outcome.missing.join(", ");
    throw refusal("NOT_FOUND", messages(locale)("error.tablesUnknown", { tables }), {
      reason: "unknown-tables",
      tables: outcome.missing.join(","),
    });
  }
  throw notRun(locale, outcome.reason, "error.queryNotRun");
}

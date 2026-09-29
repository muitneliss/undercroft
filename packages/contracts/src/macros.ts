/**
 * What a tenant-authored dbt macro is allowed to be, as a shape. ADR 0086.
 *
 * The name is the macro's Jinja name, called from a model as `{{ name(...) }}`, so it follows
 * the same identifier rule as a model's. Which names are RESERVED -- dbt's own, the platform's
 * -- and what the definition's text must be are not shapes, and are decided in
 * `@undercroft/db`'s `macroDefinition.ts`, where the Jinja is read.
 *
 * The description is required: it is what an agent reads to pick a macro to reuse rather than
 * writing the same expression into a second model.
 */

import { z } from "zod";

import { MAX_IDENTIFIER_CHARS, MODEL_NAME } from "./models.ts";

export const MacroName = z.string().regex(MODEL_NAME).max(MAX_IDENTIFIER_CHARS);
export type MacroName = z.infer<typeof MacroName>;

/** What the macro is for, in a sentence a reader choosing one can act on. */
export const MacroDescription = z.string().trim().min(1).max(500);

/** The most text one macro may hold. A macro is a helper; one bigger than this is a model. */
export const MAX_MACRO_SQL_BYTES = 16 * 1024;

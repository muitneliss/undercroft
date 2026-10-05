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

/**
 * A model's BUSINESS CONTEXT: what one row is, what identifies it, what each column means and
 * which rules the model applies. ADR 0104.
 *
 * One per model, written by a person -- an agent may only draft it -- and stored beside the
 * model (`app.model_context`). Whether it still describes the model is NOT part of it: that is
 * computed when it is read, by comparing the definition it was approved against with the one
 * there now, and never stored (`modelContext.ts` in the control plane).
 *
 * A context may be saved half-written: an empty purpose, a key with no columns, a rule with no
 * text. It is then `incomplete`, which `missingSections` names section by section, and a reader
 * sees exactly what is missing rather than a draft that was refused and lost. What the shape
 * refuses is what could never be completed into sense: a key that is both declared and
 * declared absent, a column defined twice.
 *
 * A declared key is what its author SAYS identifies a row. Nothing here tests it; the `unique`
 * test in `ModelTests` is how a model has it checked, and a reader is never told a declared key
 * is unique.
 */

/** The parts of a context, in the order a reader is asked for them. */
export const CONTEXT_SECTIONS = ["purpose", "grain", "key", "columns", "rules"] as const;
export type ContextSection = (typeof CONTEXT_SECTIONS)[number];

/** Worst first: a context that is missing a part is that before it is out of date. */
export const CONTEXT_STATES = ["incomplete", "needs_review", "current"] as const;
export type ContextState = (typeof CONTEXT_STATES)[number];

/**
 * What changed in a definition since its context was approved: the model's own SQL, its tests
 * or the columns its build found; which models it reads (`dependency`); or a model it read that
 * is gone (`missing`).
 */
export const CONTEXT_CHANGE_KINDS = ["sql", "tests", "columns", "dependency", "missing"] as const;
export type ContextChangeKind = (typeof CONTEXT_CHANGE_KINDS)[number];

/** The longest a purpose, a grain, a column's definition, a reason or a rule may be. */
export const MAX_CONTEXT_TEXT_CHARS = 2000;
/** More columns than any table this platform builds is a context pasted from somewhere else. */
export const MAX_CONTEXT_COLUMNS = 500;
export const MAX_CONTEXT_RULES = 50;

const ContextText = z.string().max(MAX_CONTEXT_TEXT_CHARS);

/**
 * What identifies one row: the columns, a composite key being several, or no key and why not
 * (an event log, a snapshot of free text). Strict, so both at once is refused rather than one
 * of them silently kept.
 */
export const ContextKey = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("declared"), columns: z.array(ModelName).max(MAX_CONTEXT_COLUMNS) })
    .strict(),
  z.object({ kind: z.literal("none"), reason: ContextText }).strict(),
]);
export type ContextKey = z.infer<typeof ContextKey>;

/** One column's meaning, and its unit or currency where it has one (`VND`, `days`). */
export const ContextColumn = z
  .object({ name: ModelName, definition: ContextText, unit: z.string().max(64).optional() })
  .strict();
export type ContextColumn = z.infer<typeof ContextColumn>;

/**
 * The business rules the model applies, or a recorded "none". `none` is a statement that the
 * model applies no rule, which is a complete answer; an empty list is a question not yet asked.
 */
export const ContextRules = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("listed"), items: z.array(ContextText).max(MAX_CONTEXT_RULES) })
    .strict(),
  z.object({ kind: z.literal("none") }).strict(),
]);
export type ContextRules = z.infer<typeof ContextRules>;

function duplicates(names: readonly string[]): string[] {
  return [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
}

export const ModelContext = z
  .object({
    purpose: ContextText,
    grain: ContextText,
    key: ContextKey.nullable(),
    columns: z.array(ContextColumn).max(MAX_CONTEXT_COLUMNS),
    rules: ContextRules.nullable(),
  })
  .strict()
  .superRefine((context, issues) => {
    // Twice is never a draft: one of the two would be the one a reader trusts, chosen by order.
    for (const name of duplicates(context.key?.kind === "declared" ? context.key.columns : [])) {
      issues.addIssue({ code: "custom", path: ["key", "columns"], message: `duplicate ${name}` });
    }
    for (const name of duplicates(context.columns.map((column) => column.name))) {
      issues.addIssue({ code: "custom", path: ["columns"], message: `duplicate ${name}` });
    }
  });
export type ModelContext = z.infer<typeof ModelContext>;

function blank(text: string): boolean {
  return text.trim() === "";
}

/**
 * The sections a context does not yet answer, in `CONTEXT_SECTIONS` order; all five for no
 * context at all. One function for the server, which decides `incomplete` from it, and for the
 * browser, which names each one beside its field -- so the two cannot disagree.
 */
export function missingSections(context: ModelContext | null): ContextSection[] {
  if (context === null) {
    return [...CONTEXT_SECTIONS];
  }
  const answered: Record<ContextSection, boolean> = {
    purpose: !blank(context.purpose),
    grain: !blank(context.grain),
    key:
      context.key !== null &&
      (context.key.kind === "declared"
        ? context.key.columns.length > 0
        : !blank(context.key.reason)),
    columns:
      context.columns.length > 0 && context.columns.every((column) => !blank(column.definition)),
    rules:
      context.rules !== null &&
      (context.rules.kind === "none" ||
        (context.rules.items.length > 0 && context.rules.items.every((item) => !blank(item)))),
  };
  return CONTEXT_SECTIONS.filter((section) => !answered[section]);
}

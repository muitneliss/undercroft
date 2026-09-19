/**
 * The question an author is editing, as the store holds it, and the decisions asked of it.
 *
 * The same idiom as the model draft: a snapshot of what the server holds rides along so
 * "unsaved" is a comparison and not a flag. A question that was never saved is unsaved by
 * definition. Switching from the builder to SQL is one way -- the SQL becomes the
 * definition and the builder cannot be recovered from it -- and the copy on the plate says
 * so before it is pressed.
 */

// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useExportsLast: Reordering modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. That ordering carries meaning; the rule's preferred one does not.

import type { ChartConfig, QuestionDefinition, VisualDefinition } from "@undercroft/contracts/bi";

import type { QuestionView } from "@/api/types.ts";

export interface QuestionDraft {
  readonly tenantId: string;
  /** Null until the first save. */
  readonly id: string | null;
  readonly name: string;
  readonly definition: QuestionDefinition;
  readonly chart: ChartConfig;
  readonly saved: {
    readonly name: string;
    readonly definition: QuestionDefinition;
    readonly chart: ChartConfig;
  } | null;
}

/** What a question gets when it does not say. Matches the server's default. */
const DEFAULT_LIMIT = 1000;

const TABLE_CHART: ChartConfig = { type: "table", y: [], options: {} };

/**
 * A new question: counting the rows of the first table, or SQL when there is none yet.
 * Counting rows is the one question every table can answer and the shortest way to see
 * that the pipeline reaches the screen.
 */
export function newQuestionDraft(tenantId: string, table: string | null): QuestionDraft {
  const definition: QuestionDefinition =
    table === null
      ? { kind: "sql", sql: "select 1 as n" }
      : {
          kind: "visual",
          table,
          fields: [{ column: "*", aggregate: "count", alias: "count" }],
          filters: [],
          groupBy: [],
          orderBy: [],
          limit: DEFAULT_LIMIT,
        };
  return { tenantId, id: null, name: "", definition, chart: TABLE_CHART, saved: null };
}

export function draftFromQuestion(tenantId: string, question: QuestionView): QuestionDraft {
  const held = { name: question.name, definition: question.definition, chart: question.chart };
  return { tenantId, id: question.id, ...held, saved: held };
}

/** Whether the draft differs from what the server holds. Never saved is always unsaved. */
export function isQuestionDirty(draft: QuestionDraft): boolean {
  if (draft.saved === null) {
    return true;
  }
  return (
    JSON.stringify({ n: draft.name, d: draft.definition, c: draft.chart }) !==
    JSON.stringify({ n: draft.saved.name, d: draft.saved.definition, c: draft.saved.chart })
  );
}

/** The builder's definition with `patch` applied; unchanged when the question is SQL. */
export function patchVisual(
  draft: QuestionDraft,
  patch: Partial<Omit<VisualDefinition, "kind">>,
): QuestionDraft {
  if (draft.definition.kind !== "visual") {
    return draft;
  }
  return { ...draft, definition: { ...draft.definition, ...patch } };
}

/** One way: the builder's SQL becomes the question. */
export function switchToSql(draft: QuestionDraft, sql: string): QuestionDraft {
  return { ...draft, definition: { kind: "sql", sql } };
}

/** The aliases a visual definition's fields answer with, for ordering and for charts. */
export function fieldAliases(definition: VisualDefinition): string[] {
  return definition.fields.map((field) => {
    if (field.column === "*") {
      return field.alias ?? "count";
    }
    if (field.aggregate === undefined) {
      return field.alias ?? field.column;
    }
    return field.alias ?? `${field.aggregate}_${field.column}`;
  });
}

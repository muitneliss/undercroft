/**
 * The bodies a screen asked a list for, read back as the types that carry them.
 *
 * The lists answer summaries unless asked (ADR 0127): `bi.questions.list` its definitions and
 * charts with `include`, `connections.list` its config, and `models.reference` is whole unless
 * an agent names `parts`. A screen that draws a body asks for it, so the server sends it -- and
 * the answer's type still says it may be absent, because the procedure's type cannot depend on
 * its input. These close that gap once, for a query's `select`.
 *
 * The same gap for a list that pages (ADR 0133): asked no `limit` and no `cursor`, which the
 * browser never sends, it answers the array, and `wholeList` says so to the type.
 *
 * One arriving without what was asked is a broken contract, so it fails the query and the
 * screen shows its own "not loaded", as `schemaAnswer.ts` does for a schema with no columns.
 * Drawing it instead would mean a tile with no chart, a scope picker that reads a missing
 * selection as "nothing chosen" and saves that, or one page of models read as all of them.
 */

import type {
  Connection,
  ConnectionWithConfig,
  ModelReference,
  ModelReferenceAnswer,
  QuestionListAnswer,
  QuestionView,
} from "@/api/types.ts";

/** For a list asked no page: the array it answers, never a page of it. */
export function wholeList<T>(answer: readonly T[] | { readonly items: readonly T[] }): T[] {
  if (!Array.isArray(answer)) {
    throw new Error("a page of a list, which the browser never asks for");
  }
  return [...answer];
}

/** For `bi.questions.list` asked `include: ["definition", "chart"]`: every question whole. */
export function bodiesListed(answer: QuestionListAnswer): QuestionView[] {
  return wholeList(answer).map((item) => {
    const { definition, chart } = item;
    if (definition === undefined || chart === undefined) {
      throw new Error("a question listed without the definition and chart the screen asked for");
    }
    return { ...item, definition, chart };
  });
}

/** For `connections.list` asked `include: ["config"]`: every card with its scope's names. */
export function configListed(items: readonly Connection[]): ConnectionWithConfig[] {
  return items.map((item) => {
    const { config } = item;
    if (config === undefined) {
      throw new Error("a connection listed without the config the screen asked for");
    }
    return { ...item, config };
  });
}

/** For `models.reference` asked for no parts: the reference whole. */
export function wholeReference(answer: ModelReferenceAnswer): ModelReference {
  if ("parts" in answer) {
    throw new Error("a reference in parts, which the browser never asks for");
  }
  return answer;
}

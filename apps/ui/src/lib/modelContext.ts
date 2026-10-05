/**
 * How a model's business context reads: its state as a mark and a word, each change since
 * approval as a sentence, and each unanswered section by name. ADR 0105.
 *
 * The state is the server's, computed when the model was read; nothing here decides it. The
 * three states take three of the four marks the build column uses, so the two columns of the
 * list scan the same way: `current` solid, `needs_review` half, `incomplete` open. None of
 * them is the word for a test -- a context is documentation, and a reader must never take a
 * declared key for a checked one.
 */

import type { ContextSection, ContextState } from "@undercroft/contracts/models";
import type { TFunction } from "i18next";

import type { ModelDetail } from "@/api/types.ts";
import type { CardFacts } from "@/lib/connectionState.ts";

export type ContextChange = ModelDetail["context"]["changes"][number];

const MARK: Readonly<Record<ContextState, CardFacts["mark"]>> = {
  current: "granted",
  needs_review: "pending",
  incomplete: "absent",
};

export function contextMark(state: ContextState): CardFacts["mark"] {
  return MARK[state];
}

export function contextStateLabel(t: TFunction, state: ContextState): string {
  switch (state) {
    case "current":
      return t("models.contextCurrent");
    case "needs_review":
      return t("models.contextNeedsReview");
    default:
      return t("models.contextIncomplete");
  }
}

export function sectionLabel(t: TFunction, section: ContextSection): string {
  switch (section) {
    case "purpose":
      return t("models.contextPurpose");
    case "grain":
      return t("models.contextGrain");
    case "key":
      return t("models.contextKey");
    case "columns":
      return t("models.contextColumns");
    default:
      return t("models.contextRules");
  }
}

/**
 * One change as a sentence. A change in the model itself and one in a model it reads are
 * different sentences, because "the SQL changed" means something else when it is not this
 * model's SQL.
 */
export function changeLine(t: TFunction, self: string, change: ContextChange): string {
  const { model } = change;
  if (change.kind === "dependency") {
    return t("models.changeDependency", { model });
  }
  if (change.kind === "missing") {
    return t("models.changeMissing", { model });
  }
  if (model === self) {
    switch (change.kind) {
      case "sql":
        return t("models.changeOwnSql");
      case "tests":
        return t("models.changeOwnTests");
      default:
        return t("models.changeOwnColumns");
    }
  }
  switch (change.kind) {
    case "sql":
      return t("models.changeUpstreamSql", { model });
    case "tests":
      return t("models.changeUpstreamTests", { model });
    default:
      return t("models.changeUpstreamColumns", { model });
  }
}

/**
 * The business context an admin is writing for one model, as the store holds it, and the two
 * questions asked of it: has it changed since it was approved, and what does the server get
 * when it is. ADR 0105.
 *
 * The form edits FIELDS, not the contract's shape: a key that is declared keeps the reason a
 * reader typed before switching it to declared, so switching back does not lose the sentence.
 * `contextFor` folds the fields into the contract by the choice that is SELECTED, at the one
 * place the draft leaves the browser, so the UI can never send a key that is both declared and
 * declared absent -- the server would refuse it, but the form should not be able to ask.
 *
 * Like `modelDraft.ts`, the draft carries what the server holds, so "unsaved" is a comparison
 * and never a flag.
 */

import type { ContextColumn, ModelContext } from "@undercroft/contracts/models";

import type { ModelDetail } from "@/api/types.ts";

/** What separates the names of a key typed as text: commas, spaces, or both. */
const KEY_SEPARATOR = /[\s,]+/u;

export interface ContextColumnFields {
  readonly name: string;
  readonly definition: string;
  /** Empty is no unit; it is left out of what is sent. */
  readonly unit: string;
}

export interface ContextFields {
  readonly purpose: string;
  readonly grain: string;
  /** `null` until a reader chooses: unanswered, which is not the same as "no key". */
  readonly keyKind: "declared" | "none" | null;
  /** The key's columns as typed: names separated by commas or spaces. */
  readonly keyColumns: string;
  readonly keyReason: string;
  readonly columns: readonly ContextColumnFields[];
  readonly rulesKind: "listed" | "none" | null;
  readonly rules: readonly string[];
}

export interface ContextDraft extends ContextFields {
  readonly tenantId: string;
  readonly name: string;
  /** What the server holds, for the unsaved indicator. */
  readonly saved: ContextFields;
}

function fieldsOf(context: ModelContext | null, built: readonly string[]): ContextFields {
  if (context === null) {
    // Nothing approved yet: the columns the last build found are offered by name, each with
    // its definition left blank for a person to write. Names are facts; meanings are not.
    return {
      purpose: "",
      grain: "",
      keyKind: null,
      keyColumns: "",
      keyReason: "",
      columns: built.map((name) => ({ name, definition: "", unit: "" })),
      rulesKind: null,
      rules: [],
    };
  }
  const { key, rules } = context;
  return {
    purpose: context.purpose,
    grain: context.grain,
    keyKind: key?.kind ?? null,
    keyColumns: key?.kind === "declared" ? key.columns.join(", ") : "",
    keyReason: key?.kind === "none" ? key.reason : "",
    columns: context.columns.map((column) => ({
      name: column.name,
      definition: column.definition,
      unit: column.unit ?? "",
    })),
    rulesKind: rules?.kind ?? null,
    rules: rules?.kind === "listed" ? rules.items : [],
  };
}

/** A draft seeded from what the server holds: nothing unsaved yet. */
export function contextDraftFrom(
  tenantId: string,
  model: Pick<ModelDetail, "name" | "context" | "lastBuild">,
): ContextDraft {
  const fields = fieldsOf(model.context.body, model.lastBuild?.columns ?? []);
  return { tenantId, name: model.name, ...fields, saved: fields };
}

/** The draft's fields alone: what is compared, and what becomes `saved` once the server has it. */
export function contextFields(draft: ContextDraft): ContextFields {
  const { purpose, grain, keyKind, keyColumns, keyReason, columns, rulesKind, rules } = draft;
  return { purpose, grain, keyKind, keyColumns, keyReason, columns, rulesKind, rules };
}

/** Whether the draft differs from what the server holds. */
export function isContextDirty(draft: ContextDraft): boolean {
  // Both sides are built by the same code in the same key order, so the text compares them.
  return JSON.stringify(contextFields(draft)) !== JSON.stringify(draft.saved);
}

/** The key's columns as typed, one name each, in the order written. */
export function keyColumnsOf(typed: string): string[] {
  return typed.split(KEY_SEPARATOR).filter((name) => name !== "");
}

/** The draft in the contract's shape, by the choices selected, for `models.setContext`. */
export function contextFor(draft: ContextDraft): ModelContext {
  let key: ModelContext["key"] = null;
  if (draft.keyKind === "declared") {
    key = { kind: "declared", columns: keyColumnsOf(draft.keyColumns) };
  } else if (draft.keyKind === "none") {
    key = { kind: "none", reason: draft.keyReason };
  }
  let rules: ModelContext["rules"] = null;
  if (draft.rulesKind === "listed") {
    rules = { kind: "listed", items: [...draft.rules] };
  } else if (draft.rulesKind === "none") {
    rules = { kind: "none" };
  }
  return {
    purpose: draft.purpose,
    grain: draft.grain,
    key,
    columns: draft.columns.map(
      (column): ContextColumn =>
        column.unit.trim() === ""
          ? { name: column.name, definition: column.definition }
          : { name: column.name, definition: column.definition, unit: column.unit },
    ),
    rules,
  };
}

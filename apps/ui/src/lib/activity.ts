/**
 * An audit row (ADR 0113) as the browser prints it: which label its action has, and what of its
 * detail a reader is shown.
 *
 * The action set is the server's (`AuditAction`, every mutation and the five events outside the
 * router), borrowed as a type, so `activity.actions` in the catalogues must answer every one. A
 * row may still name an action no catalogue knows -- one written by an older release -- and then
 * the action itself is printed: a raw name is visibly unfamiliar, a guessed label is not.
 */

import type { AuditAction } from "@undercroft/control-plane/surface";
import type { TFunction } from "i18next";

import { vi } from "@/i18n/vi.ts";

/** `bi.questions.save` -> `bi_questions_save`: i18next reads a dot in a key as nesting. */
type Underscored<S extends string> = S extends `${infer Head}.${infer Rest}`
  ? `${Head}_${Underscored<Rest>}`
  : S;

export type ActionKey = Underscored<AuditAction>;

function isActionKey(key: string): key is ActionKey {
  return Object.hasOwn(vi.activity.actions, key);
}

/** The action's label in the reader's language, or the action itself for one nobody labelled. */
export function actionLabel(t: TFunction, action: string): string {
  const key = action.replaceAll(".", "_");
  return isActionKey(key) ? t(`activity.actions.${key}`) : action;
}

/**
 * What a row's detail says, as its values: an id, an address, a role, a source.
 *
 * Values and not keys, because a key is an identifier in English (`role`, `source`) and the
 * values read on their own beside the action's label. Only text and numbers: a flag's `true`
 * is an English word too, and says nothing without the key it belongs to.
 */
export function detailNote(detail: Readonly<Record<string, unknown>>): string {
  return Object.values(detail)
    .filter((value) => typeof value === "string" || typeof value === "number")
    .join(" · ");
}

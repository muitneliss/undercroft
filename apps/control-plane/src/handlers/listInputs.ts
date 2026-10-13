/**
 * What a list takes besides the tenant -- `names` and `match` -- and what its refusal
 * of an unknown name means over HTTP, written once for every list that narrows (issue 444,
 * ADR 0127). The narrowing itself is `services/listFilter.ts`.
 *
 * Every field is optional. With none, a list answers summaries: what a reader chooses an item
 * by, never its body. Each list's own `include` names a field its items then carry in full, so
 * the one screen or agent that needs a body asks for it and nobody else pays for it.
 */

import type { Locale } from "@undercroft/core";
import { z } from "zod";

import { messages } from "../i18n/index.ts";
import type { Narrowed } from "../services/listFilter.ts";
import { refusal } from "./trpc.ts";

/** Longer than any model, macro, question or connection name. */
const MAX_NAME_CHARS = 255;

/** The most names one read may name. A reader naming more wants the whole list. */
const MAX_NAMES = 100;

/** `names` and `match`, to spread into a list's input object. */
export const NameFilterInput = {
  names: z.array(z.string().min(1).max(MAX_NAME_CHARS)).min(1).max(MAX_NAMES).optional(),
  match: z.string().min(1).max(MAX_NAME_CHARS).optional(),
};

/**
 * The items a narrowed list kept, or the refusal its unknown names mean: NOT_FOUND naming every
 * missing one, comma-joined in `details.names`, so an agent corrects them in one step.
 */
export function listedOrRefusal<T>(locale: Locale, narrowed: Narrowed<T>): T[] {
  if (narrowed.ok) {
    return narrowed.items;
  }
  const names = narrowed.missing.join(", ");
  throw refusal("NOT_FOUND", messages(locale)("error.namesUnknown", { names }), {
    reason: "unknown-names",
    names: narrowed.missing.join(","),
  });
}

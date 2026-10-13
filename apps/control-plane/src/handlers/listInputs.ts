/**
 * What a list takes besides the tenant -- `names` and `match`, and for a list that pages
 * `limit` and `cursor` -- and what its refusals mean over HTTP, written once for every list that
 * narrows (issue 444, ADR 0127) or pages (ADR 0125, ADR 0133). The narrowing itself is
 * `services/listFilter.ts`; the paging, `services/listPage.ts`.
 *
 * Every field is optional. With none, a list answers summaries: what a reader chooses an item
 * by, never its body. Each list's own `include` names a field its items then carry in full, so
 * the one screen or agent that needs a body asks for it and nobody else pays for it.
 */

import type { TRPCError } from "@trpc/server";
import type { Locale } from "@undercroft/core";
import { z } from "zod";

import { messages } from "../i18n/index.ts";
import type { Listing, Narrowed } from "../services/listFilter.ts";
import { MAX_PAGE, type Page } from "../services/listPage.ts";
import { refusal } from "./trpc.ts";

/** Longer than any model, macro, question or connection name. */
const MAX_NAME_CHARS = 255;

/** The most names one read may name. A reader naming more wants the whole list. */
const MAX_NAMES = 100;

/**
 * The longest cursor worth reading. A cursor is an item's key in base64url -- a few dozen
 * characters for a name, a few hundred for an edge's two ends; this bounds what a request may
 * make the server hold, not a format.
 */
const MAX_CURSOR_CHARS = 1024;

/** `names` and `match`, to spread into a list's input object. */
export const NameFilterInput = {
  names: z.array(z.string().min(1).max(MAX_NAME_CHARS)).min(1).max(MAX_NAMES).optional(),
  match: z.string().min(1).max(MAX_NAME_CHARS).optional(),
};

/** `limit` and `cursor`, to spread into the input object of a read that pages. */
export const PageInput = {
  limit: z.number().int().min(1).max(MAX_PAGE).optional(),
  cursor: z.string().min(1).max(MAX_CURSOR_CHARS).optional(),
};

/**
 * The items a narrowed list kept, or the refusal its unknown names mean: NOT_FOUND naming every
 * missing one, comma-joined in `details.names`, so an agent corrects them in one step.
 */
export function listedOrRefusal<T>(locale: Locale, narrowed: Narrowed<T>): T[] {
  if (narrowed.ok) {
    return narrowed.items;
  }
  throw namesRefusal(locale, narrowed.missing);
}

/**
 * What a list that pages answers -- its items whole, or a page of them -- or the refusal its
 * listing means: an unknown name as `listedOrRefusal` words it, a cursor as `cursorRefusal`.
 */
export function listingOrRefusal<T>(
  locale: Locale,
  procedure: string,
  listing: Listing<T>,
): T[] | Page<T> {
  if (listing.ok) {
    return listing.value;
  }
  throw listing.reason === "unknown-names"
    ? namesRefusal(locale, listing.missing)
    : cursorRefusal(locale, procedure);
}

/**
 * A cursor the read cannot continue from: the item it names has left the listing, or it was
 * never one this read answered. The request's fault, and `remedy: "restart"` says what fixes it
 * -- read again without one -- never a retry, which would be refused the same way.
 */
export function cursorRefusal(locale: Locale, procedure: string): TRPCError {
  return refusal("BAD_REQUEST", messages(locale)("error.pageCursorUnknown", { procedure }), {
    procedure,
    reason: "unknown-cursor",
    remedy: "restart",
  });
}

function namesRefusal(locale: Locale, missing: readonly string[]): TRPCError {
  const names = missing.join(", ");
  return refusal("NOT_FOUND", messages(locale)("error.namesUnknown", { names }), {
    reason: "unknown-names",
    names: missing.join(","),
  });
}

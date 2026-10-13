/**
 * A scope listing cut to what a reader asked for: one level of its tree, a search, a page
 * (issue 443, ADR 0125).
 *
 * The worker lists whole, as it always has -- a Drive listing is a dozen paced requests that
 * cannot be resumed half-way, and Google's own page tokens do not survive the sort that gives
 * every folder its path -- and this narrows the answer after it. What the worker knows that this
 * needs, it says on each item: `parentId` places it in the tree, `path` names where it is. So
 * the tree is the worker's knowledge and the cut is a reader's request, and neither lives in
 * the other's module.
 *
 * **`partial` passes through every cut unchanged.** It says the LISTING was incomplete, and a
 * page of an incomplete listing is a page of something incomplete: a level that reads whole
 * because the folder that would have been in it was past the bound is exactly the claim it
 * exists to stop (CLAUDE.md rule 2).
 *
 * **A page continues after an item, not at a number.** The cursor names the last item a page
 * held, and the next page starts after it in the listing as it is read THEN. A count would skip
 * or repeat whatever was added or removed before it between two calls, without a sign; an item
 * that is no longer there makes the cursor unusable, and that is refused rather than restarted
 * from the top, which would repeat a page the reader already has.
 */

import type { BrowseScopeResponse } from "@undercroft/contracts";

/** The most items one page may ask for. Past it, a reader wants the whole listing. */
export const MAX_CHOICES_PAGE = 1000;

/** What a reader asked to see of a listing. Every field optional; each only narrows. */
export interface ChoiceFilter {
  /** The items held by this one; `null` for the items at the top of the tree. */
  readonly parentId?: string | null | undefined;
  /** Items whose name, or a folder's path joined with `/`, contains this, case-insensitively. */
  readonly query?: string | undefined;
  readonly limit?: number | undefined;
  /** A `nextCursor` a previous page of the same browse answered with. */
  readonly cursor?: string | undefined;
}

/** A listing, or one page of it, and where the next page starts. */
export interface ChoicePage extends BrowseScopeResponse {
  /** Pass back as `cursor` for the page after this one; `null` when nothing follows. */
  readonly nextCursor: string | null;
}

/**
 * Why a cut could not be made. `not-a-tree`: a parent was asked of a listing no item of which
 * is placed in a tree. `unknown-parent`: no item has that id. `unknown-cursor`: the cursor is
 * not one this answered, or the item it continues after is no longer listed.
 */
export type ChoiceRefusal = (typeof CHOICE_REFUSALS)[number];

const CHOICE_REFUSALS = ["not-a-tree", "unknown-parent", "unknown-cursor"] as const;

const CHOICE_REFUSAL_SET: ReadonlySet<string> = new Set(CHOICE_REFUSALS);

/** Whether a browse was refused for its cut, rather than by the worker. */
export function isChoiceRefusal(reason: string): reason is ChoiceRefusal {
  return CHOICE_REFUSAL_SET.has(reason);
}

export type NarrowedChoices =
  | { readonly ok: true; readonly value: ChoicePage }
  | { readonly ok: false; readonly reason: ChoiceRefusal };

type Item = BrowseScopeResponse["items"][number];

/**
 * The listing cut by `filter`, in the listing's own order. With no filter it is the listing
 * whole, and `nextCursor` is `null`.
 */
export function narrowChoices(listing: BrowseScopeResponse, filter: ChoiceFilter): NarrowedChoices {
  let { items } = listing;
  if (filter.parentId !== undefined) {
    const placed = items.filter((item) => item.parentId !== undefined);
    if (placed.length === 0) {
      return { ok: false, reason: "not-a-tree" };
    }
    const { parentId } = filter;
    if (parentId !== null && !placed.some((item) => item.id === parentId)) {
      return { ok: false, reason: "unknown-parent" };
    }
    items = placed.filter((item) => item.parentId === parentId);
  }
  if (filter.query !== undefined) {
    const fragment = filter.query.toLowerCase();
    items = items.filter((item) =>
      [item.name, item.path?.join("/") ?? ""].some((text) => text.toLowerCase().includes(fragment)),
    );
  }
  if (filter.cursor !== undefined) {
    const after = items.findIndex((item) => keyOf(item) === filter.cursor);
    if (after === -1) {
      return { ok: false, reason: "unknown-cursor" };
    }
    items = items.slice(after + 1);
  }
  const { limit } = filter;
  const last = limit !== undefined && items.length > limit ? items[limit - 1] : undefined;
  return {
    ok: true,
    value: {
      items: last === undefined ? items : items.slice(0, limit),
      partial: listing.partial,
      nextCursor: last === undefined ? null : keyOf(last),
    },
  };
}

/**
 * An item's place in a listing, as an opaque cursor. Not the id alone: a HubSpot property's
 * id is its internal name, which two objects share (`createdate` on contacts and on deals).
 */
function keyOf(item: Item): string {
  return Buffer.from(JSON.stringify([item.entity ?? null, item.kind, item.id])).toString(
    "base64url",
  );
}

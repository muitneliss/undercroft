/**
 * A list cut down to the items a reader named: the one rule every list that takes `names` and
 * `match` applies -- models, macros, questions, connections (issue 444, ADR 0127) -- and the
 * one a schema's tables are cut by (`tableSchema.ts`, ADR 0125).
 *
 * **It narrows; it never guesses.** A name in `names` that no item carries is refused with the
 * names that are missing, rather than left out of a shorter list: three models asked for and two
 * returned reads as "the third is gone" or as "the third is there and the list is short", and an
 * agent acts on either. `match` is a plain substring, compared case-insensitively, for the
 * reason `tableSchema.ts` gives: a reader types a fragment of a name, and a pattern language is
 * one more thing to get subtly wrong.
 *
 * The cut is made after the read, here, rather than in each repo's SQL: a tenant's lists are
 * small to read and what was expensive was sending them (issue 444's measurements), and one
 * rule in one place cannot drift into four.
 *
 * **A list pages after it narrows** (`listed`, ADR 0133): `limit` and `cursor` cut what the
 * names left, by `listPage.ts`'s rule, so a name nothing carries is still refused before any
 * page is cut. Asked no page, a list answers the array it always has; asked one, it answers
 * `{ items, nextCursor }`. The shape follows the question rather than always being a page,
 * because the browser, the assistant and every client already reading these arrays never ask.
 */

import { type Page, type PageKey, type PageRequest, pageAfter, pageAsked } from "./listPage.ts";

/** What a reader asked to see of a list. Each field is optional and only ever narrows. */
export interface NameFilter {
  /** Exactly the items with these names. */
  readonly names?: readonly string[] | undefined;
  /** The items whose name contains this, compared case-insensitively. */
  readonly match?: string | undefined;
}

/**
 * A list's whole request: what narrows it, and which fields its items carry in full beyond their
 * summary. What `include` may name is each list's own.
 */
export interface ListRequest<Include extends string> extends NameFilter {
  readonly include?: readonly Include[] | undefined;
}

export type Narrowed<T> =
  | { readonly ok: true; readonly items: T[] }
  /** The names in `names` no item carries, in the order they were asked for. */
  | { readonly ok: false; readonly missing: readonly string[] };

/**
 * The items the filter admits, in the list's own order. With no filter at all, every item.
 * An item is named by `nameOf`; two items may share a name (a question's is not unique), and
 * a name then admits both.
 */
export function narrowByName<T>(
  items: readonly T[],
  nameOf: (item: T) => string,
  filter: NameFilter,
): Narrowed<T> {
  const held = new Set(items.map(nameOf));
  const missing = [...new Set(filter.names ?? [])].filter((name) => !held.has(name));
  if (missing.length > 0) {
    return { ok: false, missing };
  }
  const named = filter.names === undefined ? null : new Set(filter.names);
  const fragment = filter.match?.toLowerCase();
  return {
    ok: true,
    items: items.filter((item) => {
      const name = nameOf(item);
      return (
        (named === null || named.has(name)) &&
        (fragment === undefined || name.toLowerCase().includes(fragment))
      );
    }),
  };
}

/** Apply `shape` to every item a narrowing kept, and pass a refusal through unchanged. */
export function mapNarrowed<T, U>(narrowed: Narrowed<T>, shape: (item: T) => U): Narrowed<U> {
  return narrowed.ok ? { ok: true, items: narrowed.items.map(shape) } : narrowed;
}

/** A list's whole request, for a list that also pages. */
export interface PagedListRequest<Include extends string>
  extends ListRequest<Include>,
    PageRequest {}

/** What a list answers: every item it kept, one page of them, or why it answered neither. */
export type Listing<T> =
  | { readonly ok: true; readonly value: T[] | Page<T> }
  /** The names in `names` no item carries, in the order they were asked for. */
  | { readonly ok: false; readonly reason: "unknown-names"; readonly missing: readonly string[] }
  | { readonly ok: false; readonly reason: "unknown-cursor" };

/**
 * A narrowed list as its reader asked for it: the items whole when `page` names neither a
 * `limit` nor a `cursor`, else the page of them it names (`pageAsked`, whose `defaultLimit` a
 * list may lower). `keyOf` must tell every item apart in the list's own order.
 */
export function listed<T>(
  narrowed: Narrowed<T>,
  keyOf: (item: T) => PageKey,
  page: PageRequest,
  defaultLimit?: number,
): Listing<T> {
  if (!narrowed.ok) {
    return { ok: false, reason: "unknown-names", missing: narrowed.missing };
  }
  const asked = pageAsked(page, defaultLimit);
  return asked === null
    ? { ok: true, value: narrowed.items }
    : pageAfter(narrowed.items, keyOf, asked);
}

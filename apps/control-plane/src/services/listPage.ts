/**
 * A listing read a page at a time: the one paging rule for every read that pages -- the scope
 * browse (ADR 0125), the inventory lists and the lineage (ADR 0133).
 *
 * **A page continues after an item, not at a number.** The cursor names the last item a page
 * held, and the next page starts after it in the listing as it is read THEN. A count would skip
 * or repeat whatever was added or removed before it between two calls, without a sign. An item
 * that is no longer there makes the cursor unusable, and that is refused as `unknown-cursor`
 * rather than restarted from the top, which would repeat a page the reader already has and
 * read to them as the next one.
 *
 * That is the opposite of `@undercroft/db`'s `cursor.ts`, which reads a stale keyset bookmark
 * as "from the top". That one pages a log ordered by time, where a row never leaves the middle
 * of the order; these page listings an author edits, where one does.
 *
 * The cursor is an item's key as JSON, in base64url: opaque to the reader, who only hands it
 * back, and compared here only for equality with the key of an item the listing holds now. So a
 * cursor that was never one of ours finds no item and is refused the same way, never read as a
 * place it could not be or thrown on. The key is the caller's: whatever tells two items of its listing
 * apart in the order it reads them -- a model's name, a question's id, an edge's two ends.
 */

/**
 * What tells one item of a listing from every other: a string, or a few of them (a part may be
 * `null`, for a field an item does not carry). Never `null` itself, which `pageBoth` spends on
 * "this list is done".
 */
export type PageKey = string | readonly (string | null)[];

/** The most items one page may ask for. Past it, a reader wants the whole listing. */
export const MAX_PAGE = 1000;

/**
 * The page a reader gets who sent a `cursor` and no `limit`, for a read that defaults one: the
 * 50 items an MCP answer shows of any list before it clips (ADR 0122), so a page an agent asked
 * for whole arrives whole.
 */
export const DEFAULT_PAGE = 50;

/** Which page of a listing a reader asked for. Neither field: the listing whole. */
export interface PageRequest {
  /** At most this many items. Absent with a cursor: the rest of the listing after it. */
  readonly limit?: number | undefined;
  /** A `nextCursor` a previous page of the same read answered with. */
  readonly cursor?: string | undefined;
}

/** One page of a listing, and where the next one starts. */
export interface Page<T> {
  readonly items: T[];
  /** Pass back as `cursor` for the page after this one; `null` when nothing follows. */
  readonly nextCursor: string | null;
}

/** Two listings paged in step, as `pageBoth` answers them. */
export interface PagePair<A, B> {
  readonly items: readonly [A[], B[]];
  /** `null` only once both listings are done. */
  readonly nextCursor: string | null;
}

export type Paged<V> =
  | { readonly ok: true; readonly value: V }
  /** The cursor is not one this read answered, or the item it continues after is gone. */
  | { readonly ok: false; readonly reason: "unknown-cursor" };

/** A listing to page through, and the key of each of its items. */
export interface Paging<T> {
  readonly items: readonly T[];
  readonly keyOf: (item: T) => PageKey;
}

const UNKNOWN_CURSOR = { ok: false, reason: "unknown-cursor" } as const;

/**
 * The page a read was asked for, for a read that answers whole unless asked a page: `null` when
 * the request names neither a `limit` nor a `cursor`, else the request with `defaultLimit` for a
 * cursor that came alone. Here once, so every such read decides "was a page asked" alike.
 */
export function pageAsked(
  request: PageRequest,
  defaultLimit: number = DEFAULT_PAGE,
): PageRequest | null {
  if (request.limit === undefined && request.cursor === undefined) {
    return null;
  }
  return { limit: request.limit ?? defaultLimit, cursor: request.cursor };
}

/**
 * The page of `items` that `request` asks for, in the listing's own order. With neither field it
 * is the listing whole, and `nextCursor` is `null`.
 */
export function pageAfter<T>(
  items: readonly T[],
  keyOf: (item: T) => PageKey,
  request: PageRequest,
): Paged<Page<T>> {
  const after = request.cursor === undefined ? undefined : textOf(request.cursor);
  const cut = cutAfter({ items, keyOf }, after, request.limit);
  if (cut === null) {
    return UNKNOWN_CURSOR;
  }
  return {
    ok: true,
    value: { items: cut.items, nextCursor: cut.last === null ? null : cursorOf(cut.last) },
  };
}

/**
 * One page of each of two listings read as one answer -- a graph's nodes and its edges -- each
 * holding at most `limit` items and continuing after its own last one. One cursor carries both
 * places, and a listing done before the other answers empty pages until its partner is done.
 */
export function pageBoth<A, B>(
  first: Paging<A>,
  second: Paging<B>,
  request: PageRequest,
): Paged<PagePair<A, B>> {
  const places = request.cursor === undefined ? FROM_THE_TOP : placesIn(request.cursor);
  if (places === null) {
    return UNKNOWN_CURSOR;
  }
  const [inFirst, inSecond] = places;
  const a = inFirst === null ? DONE : cutAfter(first, inFirst, request.limit);
  const b = inSecond === null ? DONE : cutAfter(second, inSecond, request.limit);
  if (a === null || b === null) {
    return UNKNOWN_CURSOR;
  }
  return {
    ok: true,
    value: {
      items: [a.items, b.items],
      nextCursor: a.last === null && b.last === null ? null : cursorOf([a.last, b.last]),
    },
  };
}

/** A cut: the items kept, and the key of the last of them when more follow, else `null`. */
interface Cut<T> {
  readonly items: T[];
  readonly last: PageKey | null;
}

const DONE: Cut<never> = { items: [], last: null };

/** Where `pageBoth` starts each listing when it is given no cursor. */
const FROM_THE_TOP = [undefined, undefined] as const;

/**
 * The items after the one whose key's JSON is `after` (from the top when `undefined`), at most
 * `limit` of them; `null` when no item has that key.
 */
function cutAfter<T>(
  listing: Paging<T>,
  after: string | undefined,
  limit: number | undefined,
): Cut<T> | null {
  let rest = [...listing.items];
  if (after !== undefined) {
    const at = rest.findIndex((item) => JSON.stringify(listing.keyOf(item)) === after);
    if (at === -1) {
      return null;
    }
    rest = rest.slice(at + 1);
  }
  if (limit === undefined || rest.length <= limit) {
    return { items: rest, last: null };
  }
  const kept = rest.slice(0, limit);
  const last = kept.at(-1);
  return { items: kept, last: last === undefined ? null : listing.keyOf(last) };
}

function cursorOf(key: PageKey | readonly (PageKey | null)[]): string {
  return Buffer.from(JSON.stringify(key)).toString("base64url");
}

/** A cursor's JSON. Never throws: base64url decoding skips what is not its alphabet. */
function textOf(cursor: string): string {
  return Buffer.from(cursor, "base64url").toString("utf8");
}

/**
 * Where a `pageBoth` cursor left each listing: its last key's JSON, or `null` for a listing
 * done. `null` for a cursor that is not two places, which no `pageBoth` answered.
 */
function placesIn(cursor: string): readonly [string | null, string | null] | null {
  let places: unknown;
  try {
    places = JSON.parse(textOf(cursor));
  } catch {
    return null;
  }
  if (!Array.isArray(places) || places.length !== 2) {
    return null;
  }
  const [inFirst, inSecond]: unknown[] = places;
  return [placeOf(inFirst), placeOf(inSecond)];
}

function placeOf(place: unknown): string | null {
  return place === null ? null : JSON.stringify(place);
}

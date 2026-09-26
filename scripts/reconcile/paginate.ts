/**
 * Walking a paged listing to its end, and saying so only when it got there.
 *
 * A reconciliation built on an incomplete listing reports every record past the last page as
 * missing -- or, worse, reports a clean match over the half it saw. Four ways a listing stops
 * short without an error, each of which this walk detects rather than trusts:
 *
 * - **a page cap.** Stopping at N pages while a cursor is still offered is truncation, not the
 *   end. `exhausted` is true only when the source itself returned no further cursor.
 * - **a repeating cursor.** A cursor seen before means the walk would loop; it stops and says
 *   so instead of spinning or quietly returning what it had.
 * - **a record on two pages.** Offset paging over a changing set repeats rows at the seam;
 *   each id is kept once and the repeats are counted.
 * - **a declared total the walk did not reach.** When the system states how many records it
 *   holds, fewer after exhaustion is a short read the caller must see.
 */

export interface Page<T> {
  readonly items: readonly T[];
  /** The cursor for the next page; empty or absent when the listing has ended. */
  readonly next?: string | null;
}

export interface Walk<T> {
  readonly items: readonly T[];
  readonly pages: number;
  /** The source said there was nothing further. The only state that proves completeness. */
  readonly exhausted: boolean;
  readonly truncatedByCap: boolean;
  readonly loopDetected: boolean;
  /** Ids delivered more than once, and how many extra times. */
  readonly repeats: ReadonlyMap<string, number>;
  /** `declaredTotal - items.length` when a total was declared and the walk was exhausted. */
  readonly shortBy: number | null;
}

export interface WalkOptions<T> {
  readonly maxPages: number;
  readonly idOf: (item: T) => string;
  readonly declaredTotal?: number;
}

export async function walkPages<T>(
  fetchPage: (cursor: string | null) => Promise<Page<T>>,
  options: WalkOptions<T>,
): Promise<Walk<T>> {
  const byId = new Map<string, T>();
  const repeats = new Map<string, number>();
  const cursorsSeen = new Set<string>();
  let cursor: string | null = null;
  let pages = 0;
  let exhausted = false;
  let loopDetected = false;
  while (pages < options.maxPages) {
    const page = await fetchPage(cursor);
    pages += 1;
    for (const item of page.items) {
      const id = options.idOf(item);
      if (byId.has(id)) {
        repeats.set(id, (repeats.get(id) ?? 0) + 1);
      } else {
        byId.set(id, item);
      }
    }
    const next = page.next ?? "";
    if (next.length === 0) {
      exhausted = true;
      break;
    }
    if (cursorsSeen.has(next)) {
      loopDetected = true;
      break;
    }
    cursorsSeen.add(next);
    cursor = next;
  }
  const items = [...byId.values()];
  const shortBy =
    exhausted && options.declaredTotal !== undefined ? options.declaredTotal - items.length : null;
  return {
    items,
    pages,
    exhausted,
    truncatedByCap: !(exhausted || loopDetected),
    loopDetected,
    repeats,
    shortBy,
  };
}

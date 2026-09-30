/**
 * The Reports list, searched by name: dashboards and questions alike, accents ignored.
 *
 * Folded with `foldForSearch` (`lib/labelIndex.ts`), the customer search's own fold, so
 * `doanh thu` finds `Doanh thu tháng` and `cong no` finds `Công nợ` exactly as a customer is
 * found -- and not with the raw lake's `lib/fold.ts`, whose fold keeps a string's length for
 * highlighting and answers a different question. An empty query lists everything.
 */

import { foldForSearch } from "@/lib/labelIndex.ts";

/** The search key the query rides under, so a filtered list is a link. */
export const REPORT_QUERY = "q";

export function byName<T extends { readonly name: string }>(
  items: readonly T[],
  query: string,
): T[] {
  const needle = foldForSearch(query.trim());
  return needle === ""
    ? [...items]
    : items.filter((item) => foldForSearch(item.name).includes(needle));
}

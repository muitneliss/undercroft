/**
 * Joining a question's rows to a map's regions, and saying which rows found no region.
 *
 * A row's label matches a region by its code (`92`, `704`) or by either of its names with
 * diacritics folded and case dropped, so `Cần Thơ`, `can tho` and `Can Tho` all land on
 * the same province. What does not match is LISTED, never dropped: a map that silently
 * left five provinces blank because their names were spelled with a different accent is
 * the invisible wrongness rule 2 exists to prevent.
 */

// biome-ignore-all lint/style/useExportsLast: Reordering modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. That ordering carries meaning; the rule's preferred one does not.

import { foldForSearch } from "@/lib/labelIndex.ts";

export interface Region {
  /** The key the drawn feature carries: the country's or province's code. */
  readonly code: string;
  readonly names: readonly string[];
}

export interface RegionRow {
  readonly label: string;
  readonly value: number | null;
  readonly raw: string | null;
}

export interface Joined {
  /** By region code: the row that matched it. */
  readonly byCode: Map<string, RegionRow>;
  /** Labels that matched no region, in row order. */
  readonly unmatched: string[];
}

/** The lookup a join uses: every code and every folded name, to its code. */
function indexOf(regions: readonly Region[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const region of regions) {
    index.set(region.code, region.code);
    index.set(foldForSearch(region.code), region.code);
    for (const name of region.names) {
      index.set(foldForSearch(name), region.code);
    }
  }
  return index;
}

export function joinRegions(regions: readonly Region[], rows: readonly RegionRow[]): Joined {
  const index = indexOf(regions);
  const byCode = new Map<string, RegionRow>();
  const unmatched: string[] = [];
  for (const row of rows) {
    const code = index.get(row.label) ?? index.get(foldForSearch(row.label));
    if (code === undefined) {
      unmatched.push(row.label);
    } else if (!byCode.has(code)) {
      byCode.set(code, row);
    }
  }
  return { byCode, unmatched };
}

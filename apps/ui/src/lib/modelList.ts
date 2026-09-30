/**
 * The Models list's address, and what it narrows the list to: a search by name (`?q=`), a
 * last-build state (`?build=`, `modelBuild.ts`) and an order (`?sort=`).
 *
 * All three live in the address, never the store, for the reason the build state already
 * does: Back restores the list a reader came from, and a pasted link opens the same one. This
 * module is the one place that knows the three parameter names and how they combine, so a
 * link that changes one of them keeps the other two -- a count pressed in a searched list
 * stays searched.
 *
 * The counts above the list are over what the SEARCH matches, not over every model: they are
 * one per state and must add up to the models the list covers, and a search that left them
 * counting models the reader filtered out would print a sum that is not the list's.
 */

import { foldForSearch } from "@/lib/labelIndex.ts";
import { BUILD_PARAM, BUILD_STATES, buildFilter, buildState } from "@/lib/modelBuild.ts";

export const QUERY_PARAM = "q";
export const SORT_PARAM = "sort";

/** Attention first is the default and is never written: `?sort=attention` is a link nobody meant. */
export const MODEL_SORTS = ["attention", "name"] as const;
export type ModelSort = (typeof MODEL_SORTS)[number];

interface Listed {
  readonly name: string;
  readonly lastBuild: { readonly status: string } | null;
}

/** The three filters as the address holds them; an unknown sort or state is ignored. */
export interface ModelListFilters {
  readonly query: string;
  readonly build: ReturnType<typeof buildFilter>;
  readonly sort: ModelSort;
}

export function modelListFilters(params: URLSearchParams): ModelListFilters {
  const sort = params.get(SORT_PARAM);
  return {
    query: params.get(QUERY_PARAM) ?? "",
    build: buildFilter(params),
    sort: MODEL_SORTS.find((known) => known === sort) ?? "attention",
  };
}

/** Whether anything narrows or reorders the list, so a "clear" has something to clear. */
export function isNarrowed(filters: ModelListFilters): boolean {
  return filters.query !== "" || filters.build !== null || filters.sort !== "attention";
}

/**
 * The models the search matches (what the counts are over), and of those the ones the build
 * state keeps, in the chosen order. Attention first orders by the counts' own order -- failed,
 * never built, other, built -- and then by name, so the two agree on what needs a person.
 */
export function narrowModels<T extends Listed>(
  models: readonly T[],
  filters: ModelListFilters,
): { matched: T[]; shown: T[] } {
  const needle = foldForSearch(filters.query.trim());
  const matched =
    needle === "" ? [...models] : models.filter((m) => foldForSearch(m.name).includes(needle));
  function rank(model: T): number {
    return BUILD_STATES.indexOf(buildState(model.lastBuild?.status ?? null));
  }
  const shown = matched
    .filter(
      (m) => filters.build === null || buildState(m.lastBuild?.status ?? null) === filters.build,
    )
    .sort((a, b) =>
      filters.sort === "name"
        ? a.name.localeCompare(b.name)
        : rank(a) - rank(b) || a.name.localeCompare(b.name),
    );
  return { matched, shown };
}

/**
 * `params` with the given filters changed and the rest kept. A filter set to its default -- an
 * empty query, no state, attention first -- is removed rather than written.
 */
export function withFilters(
  params: URLSearchParams,
  change: { readonly query?: string; readonly build?: string | null; readonly sort?: ModelSort },
): URLSearchParams {
  const next = new URLSearchParams(params);
  function put(name: string, value: string | null | undefined, fallback: string): void {
    if (value === undefined) {
      return;
    }
    if (value === null || value === fallback) {
      next.delete(name);
    } else {
      next.set(name, value);
    }
  }
  put(QUERY_PARAM, change.query, "");
  put(BUILD_PARAM, change.build, "");
  put(SORT_PARAM, change.sort, "attention");
  return next;
}

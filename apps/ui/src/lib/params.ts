/**
 * A question's parameters and where their values live: the URL.
 *
 * `{{name}}` in a question's SQL is a hole a dashboard filter or a person fills. The values
 * live in the search string as `p.<name>=...`, so a question run with a filter set is a
 * link a colleague can open on the same rows, and a reload keeps them. Nothing here binds
 * anything -- the server does, as literals -- this only reads and writes the search string
 * and says which names have no value, because a run with a hole in it is refused rather
 * than run with a guess.
 */

export const PARAM_PREFIX = "p.";

export interface BoundParams {
  readonly params: Record<string, string>;
  /** Names with no value in the search string. Non-empty means the run is refused. */
  readonly missing: string[];
}

/** The values the search string holds for `names`, and which it does not. */
export function paramsFromSearch(search: URLSearchParams, names: readonly string[]): BoundParams {
  const params: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of names) {
    const value = search.get(`${PARAM_PREFIX}${name}`);
    if (value === null || value === "") {
      missing.push(name);
    } else {
      params[name] = value;
    }
  }
  return { params, missing };
}

/** The search string with one parameter set, or removed when the value is empty. */
export function withParam(search: URLSearchParams, name: string, value: string): URLSearchParams {
  const next = new URLSearchParams(search);
  if (value === "") {
    next.delete(`${PARAM_PREFIX}${name}`);
  } else {
    next.set(`${PARAM_PREFIX}${name}`, value);
  }
  return next;
}

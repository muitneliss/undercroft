/**
 * A question's parameters and where their values live: the URL.
 *
 * `{{name}}` in a question's SQL is a hole a dashboard filter or a person fills. The values
 * live in the search string as `p.<name>=...`, so a question run with a filter set is a
 * link a colleague can open on the same rows, and a reload keeps them. Nothing here binds
 * anything -- the server does, as literals -- this only reads and writes the search string
 * and says which names have no value, because a run with a hole in it is refused rather
 * than run with a guess. It also answers which holes a question HAS, which is the same
 * question one step earlier and the one every caller of the first needs answered first.
 */

import { compile, paramNames, type QuestionDefinition } from "@undercroft/contracts/bi";

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

/**
 * The `{{holes}}` a saved question asks for, whichever way it was written.
 *
 * Compiling can REFUSE: a visual filter can be stored with its operator set and its value
 * gone -- changing a filter's column clears the value, and `saveQuestion` does not compile
 * what it stores -- and the compiler will not write `"amount" >= ` with nothing after it.
 * That refusal belongs to the RUN, where the server reports it in the compiler's own words
 * against the tile that owns it. It must not escape from whatever was merely asking which
 * holes the question has: a dashboard tile asks that during render, and this SPA has no
 * error boundary, so a throw here unmounts the page rather than spoiling one card.
 *
 * So an uncompilable question asks for no holes and is therefore run -- which is exactly how
 * its refusal reaches the reader, attached to the tile it belongs to.
 */
export function questionParams(definition: QuestionDefinition): string[] {
  try {
    return paramNames(compile(definition));
  } catch {
    return [];
  }
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

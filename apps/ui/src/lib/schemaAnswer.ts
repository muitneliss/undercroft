/**
 * The schema with its columns, which is all the browser ever asks `bi.schema` and
 * `lake.querySchema` for.
 *
 * The procedures answer with table names alone only when asked `columns: false` (issue 443),
 * which no screen sends. One arriving anyway is a broken contract, so it fails the query -- the
 * screen shows its own "not loaded" -- rather than being drawn as tables that have no columns,
 * which is the one reading of a names-only answer that would be false.
 */

import type { SchemaAnswer, SchemaView } from "@/api/types.ts";

/** For a schema query's `select`: the answer with columns, or a failed query. */
export function columnsListed(answer: SchemaAnswer): SchemaView {
  if ("columns" in answer) {
    throw new Error("a schema answer without columns, which the browser never asks for");
  }
  return answer;
}

/**
 * What the tenant's models declare they read, as `models.lineage` answers it: the graph, the
 * part of it around one node, or one page of either (ADR 0092, ADR 0125, ADR 0133).
 *
 * Split from `models.ts`, which keeps what a model IS -- listed, read, saved, deleted. This is
 * what the models say about one another, read from their text and from nothing else.
 */

import type { SqlExecutor } from "@undercroft/db";
import { listMacros, listModels, listSeedSummaries } from "@undercroft/db/repos";
import {
  type Lineage,
  type LineageTarget,
  lineageAround,
  modelLineage,
} from "@undercroft/db/services";

import { type PageRequest, pageAsked, pageBoth } from "./listPage.ts";

/** One page of a lineage: at most `limit` nodes and `limit` edges, and where the next starts. */
export interface LineagePage extends Lineage {
  /** `null` once every node and every edge has been on a page. */
  readonly nextCursor: string | null;
}

export type LineageAnswer =
  | { readonly ok: true; readonly value: Lineage | LineagePage }
  /** `unknown-name`: the target names no node of the graph. `unknown-cursor`: `listPage.ts`. */
  | { readonly ok: false; readonly reason: "unknown-name" | "unknown-cursor" };

/**
 * Which of the tenant's models read which, and which raw lake tables and seeds, read from the
 * saved models' and macros' own declarations and from nothing else (`modelLineage.ts`, ADR 0092).
 * Computed on every call rather than stored: a stored graph would be one more thing a save
 * could leave stale, and the text it is read from is already here.
 *
 * With a `target`, only the part around the node it names (`lineageAround`), and `unknown-name`
 * when the tenant's graph has no such node. The whole graph is read either way: which models
 * reach a node is only known once every model's declarations are.
 *
 * Asked a page (ADR 0133), the same part a page at a time: its nodes and its edges each in the
 * graph's own order, each continuing after its own last item -- a node by its id, an edge by its
 * two ends, which no two edges share. Every page narrows by the same target first, so the walk
 * is the part around the node and nothing else.
 */
export async function lineage(
  exec: SqlExecutor,
  tenantId: string,
  target: LineageTarget | null = null,
  page: PageRequest = {},
): Promise<LineageAnswer> {
  const [models, macros, seeds] = await Promise.all([
    listModels(exec, tenantId),
    listMacros(exec, tenantId),
    listSeedSummaries(exec, tenantId),
  ]);
  const graph = modelLineage({ models, macros, seeds: seeds.map((seed) => seed.name) });
  const part = target === null ? graph : lineageAround(graph, target);
  if (part === null) {
    return { ok: false, reason: "unknown-name" };
  }
  const asked = pageAsked(page);
  if (asked === null) {
    return { ok: true, value: part };
  }
  const paged = pageBoth(
    { items: part.nodes, keyOf: (node) => node.id },
    { items: part.edges, keyOf: (edge) => [edge.from, edge.to] },
    asked,
  );
  if (!paged.ok) {
    return paged;
  }
  const [nodes, edges] = paged.value.items;
  return { ok: true, value: { nodes, edges, nextCursor: paged.value.nextCursor } };
}

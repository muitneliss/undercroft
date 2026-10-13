/**
 * The part of a lineage graph around one node: what `models.lineage` answers when a reader
 * names the model or raw table they are asking about (issue 443, ADR 0125).
 *
 * Pure, and over the whole graph `modelLineage` drew: which nodes reach a model is known only
 * once every model's declarations are read, so the cut is made after, never instead.
 */

import type { Lineage, LineageEdge } from "./modelLineage.ts";

/** Which way to walk from a node: what it reads (`up`), what reads it (`down`), or both. */
export type LineageDirection = "up" | "down" | "both";

/** The node a reader asked about, and how far around it to look. */
export interface LineageTarget {
  /**
   * A node's `name`, as the graph spells it: a model's name, a raw lake table as
   * `schema.table` (`raw.records`), or a missing dependency as it was written.
   */
  readonly name: string;
  readonly direction: LineageDirection;
  /** How many edges away a node may be and still be kept; `null` for no bound. */
  readonly depth: number | null;
}

/**
 * The part of a graph around one node: the nodes reachable from it within `depth` edges in
 * `direction`, the node itself, and every edge of the graph between two of them.
 *
 * `both` is the node's ancestors and its descendants, each walked on its own -- never a walk
 * that turns round, which would reach a model's siblings and call them related. An edge is
 * kept whenever both its ends are, so two kept parents that read one another still show it:
 * the subgraph says less than the graph, never something the graph does not.
 *
 * `null` when no node carries the name. An empty graph would read as "nothing reads this and
 * it reads nothing", which is a claim about a model that may not exist (CLAUDE.md rule 2).
 * Should a raw table and a missing dependency share a name -- `source('raw', 'records')`
 * written against a source called `undercroft` -- the walk starts from both: the reader named
 * the text, and choosing one would be a guess about which they meant.
 */
export function lineageAround(graph: Lineage, target: LineageTarget): Lineage | null {
  const seeds = graph.nodes.filter((node) => node.name === target.name).map((node) => node.id);
  if (seeds.length === 0) {
    return null;
  }
  const ways: ("up" | "down")[] = target.direction === "both" ? ["up", "down"] : [target.direction];
  const kept = new Set(ways.flatMap((way) => [...walk(graph.edges, seeds, target.depth, way)]));
  return {
    nodes: graph.nodes.filter((node) => kept.has(node.id)),
    edges: graph.edges.filter((edge) => kept.has(edge.from) && kept.has(edge.to)),
  };
}

/** Every node reached from `seeds` within `depth` steps one way, breadth first. */
function walk(
  edges: readonly LineageEdge[],
  seeds: readonly string[],
  depth: number | null,
  way: "up" | "down",
): Set<string> {
  const reached = new Set<string>(seeds);
  let frontier = new Set<string>(seeds);
  let steps = depth ?? Number.POSITIVE_INFINITY;
  while (frontier.size > 0 && steps > 0) {
    steps -= 1;
    const next = new Set<string>();
    for (const edge of edges) {
      const [here, there] = way === "up" ? [edge.to, edge.from] : [edge.from, edge.to];
      if (frontier.has(here) && !reached.has(there)) {
        reached.add(there);
        next.add(there);
      }
    }
    frontier = next;
  }
  return reached;
}

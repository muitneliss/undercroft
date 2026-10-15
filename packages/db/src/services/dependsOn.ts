/**
 * What each model of a lineage graph declares it reads, as a list per model rather than a
 * graph: what `models.list` answers under `include: ["dependsOn"]` (ADR 0137).
 *
 * Pure, and over the whole graph `modelLineage` drew (ADR 0092), so the list and
 * `models.lineage` cannot disagree: nothing here reads a model's SQL a second time, and an edge
 * the graph does not hold is not invented for the list.
 */

import type { Lineage, LineageNode, Undeclared } from "./modelLineage.ts";

/** One thing a model declares it reads: a node's kind and name, and the macro declaring it. */
export interface Dependency {
  readonly kind: LineageNode["kind"];
  readonly name: string;
  /** The macro whose own text declares it, or `null` when the model's text does. */
  readonly via: string | null;
}

/**
 * What one model declares it reads, as a list rather than a graph (`models.list`, ADR 0137).
 *
 * `reads` empty with `undeclared` non-empty is NOT a model that reads nothing: it is a model
 * whose upstream cannot be read from its declarations, and the reasons say why (rule 2). Only
 * both empty says the model declares no read at all.
 */
export interface DependsOn {
  readonly reads: readonly Dependency[];
  readonly undeclared: readonly Undeclared[];
}

/**
 * Each model of the graph by name, with what it declares it reads: the `from` of every edge
 * into it, in the graph's own order, and its undeclared reasons. A model in the graph is in the
 * map even when it reads nothing, so an absent name is a model the graph does not hold, never a
 * model with no dependencies.
 */
export function dependsOnByModel(graph: Lineage): Map<string, DependsOn> {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const reads = new Map<string, Dependency[]>();
  const byModel = new Map<string, DependsOn>();
  for (const node of graph.nodes) {
    if (node.kind === "model") {
      const own: Dependency[] = [];
      reads.set(node.id, own);
      byModel.set(node.name, { reads: own, undeclared: node.undeclared });
    }
  }
  for (const edge of graph.edges) {
    const from = byId.get(edge.from);
    if (from !== undefined) {
      reads.get(edge.to)?.push({ kind: from.kind, name: from.name, via: edge.via });
    }
  }
  return byModel;
}

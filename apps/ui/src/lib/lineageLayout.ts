/**
 * Where each node of the lineage sits on the board, without a word or a pixel: its column, and
 * its place within the column. `LineageCanvas` turns these into pixels and the text list into
 * an order.
 *
 * A column is the length of the longest declared chain below a node (ADR 0092), so a column says
 * how far a model stands from the raw lake; the order within a column is only a heuristic for
 * fewer crossings, and a reader who disagrees with it drags the card.
 */

import type { LineageNode, ModelLineage } from "@/api/types.ts";
import { childrenOf, parentsOf } from "@/lib/lineage.ts";

export interface Placed {
  readonly node: LineageNode;
  /** 0 for a raw lake table or a missing dependency; a model one past its deepest parent. */
  readonly column: number;
  /** The node's place in its column, counted from the top. */
  readonly row: number;
  /** The same place measured from the column's middle, so every column centres on one line. */
  readonly offset: number;
}

export interface Layout {
  readonly placed: readonly Placed[];
  readonly columns: number;
  readonly rows: number;
}

/** Each node's column: the longest declared chain below it, a cycle followed once. */
function columnsOf(graph: ModelLineage): Map<string, number> {
  const columns = new Map<string, number>();
  const open = new Set<string>();
  function columnOf(node: LineageNode): number {
    const known = columns.get(node.id);
    if (known !== undefined) {
      return known;
    }
    if (node.kind !== "model") {
      columns.set(node.id, 0);
      return 0;
    }
    open.add(node.id);
    let deepest = 0;
    for (const edge of parentsOf(graph, node.id)) {
      const parent = graph.nodes.find((candidate) => candidate.id === edge.from);
      if (parent !== undefined && !open.has(parent.id)) {
        deepest = Math.max(deepest, columnOf(parent));
      }
    }
    open.delete(node.id);
    columns.set(node.id, deepest + 1);
    return deepest + 1;
  }
  for (const node of graph.nodes) {
    columnOf(node);
  }
  return columns;
}

/**
 * How many times the ordering sweeps right and back. Each sweep can only move a node toward
 * its neighbours, and on a tenant's real project the order stopped changing after three.
 */
const SWEEPS = 4;

/**
 * Where every node sits: its column, and its place within the column.
 *
 * The order within a column is the barycentre heuristic, swept both ways: going right, each
 * node moves to the mean place of what it reads; coming back, to the mean place of what reads
 * it. So a raw table sits beside the models that read it and a model beside its inputs, and
 * the drawn edges cross far less than a single pass left them. Places are measured from the
 * column's middle, because the drawing centres every column on one line: a short column sits
 * opposite the middle of a long one rather than hanging off its top.
 *
 * `drawn` is the part of `graph` on the page (`drawnGraph`). Its nodes are ordered among
 * themselves, but their columns are still read off the whole graph: a column says how far a
 * model is from the raw lake, and narrowing the drawing does not shorten a model's chain.
 */
export function layout(graph: ModelLineage, drawn: ModelLineage = graph): Layout {
  const columns = columnsOf(graph);
  const count = Math.max(0, ...columns.values()) + 1;
  const lanes: LineageNode[][] = Array.from({ length: count }, () => []);
  for (const node of drawn.nodes) {
    lanes[columns.get(node.id) ?? 0]?.push(node);
  }
  const parents = new Map(drawn.nodes.map((n) => [n.id, parentsOf(drawn, n.id)]));
  const children = new Map(drawn.nodes.map((n) => [n.id, childrenOf(drawn, n.id)]));
  const at = new Map<string, number>();

  function settle(lane: readonly LineageNode[]): void {
    for (const [row, node] of lane.entries()) {
      at.set(node.id, row - (lane.length - 1) / 2);
    }
  }
  function reorder(lane: LineageNode[], neighbours: (id: string) => readonly string[]): void {
    const weight = new Map(
      lane.map((node) => {
        const places = neighbours(node.id)
          .map((id) => at.get(id))
          .filter((place) => place !== undefined);
        const mean =
          places.length === 0
            ? (at.get(node.id) ?? 0)
            : places.reduce((sum, place) => sum + place, 0) / places.length;
        return [node.id, mean];
      }),
    );
    lane.sort((a, b) => (weight.get(a.id) ?? 0) - (weight.get(b.id) ?? 0));
    settle(lane);
  }

  function reads(id: string): string[] {
    return (parents.get(id) ?? []).map((edge) => edge.from);
  }
  function readBy(id: string): string[] {
    return (children.get(id) ?? []).map((edge) => edge.to);
  }
  for (const lane of lanes) {
    settle(lane);
  }
  for (let sweep = 0; sweep < SWEEPS; sweep += 1) {
    for (const lane of lanes.slice(1)) {
      reorder(lane, reads);
    }
    for (const lane of lanes.slice(0, -1).reverse()) {
      reorder(lane, readBy);
    }
  }
  // A last pass right, so every model ends beside what it reads.
  for (const lane of lanes.slice(1)) {
    reorder(lane, reads);
  }

  const placed = lanes.flatMap((lane, column) =>
    lane.map((node, row) => ({ node, column, row, offset: at.get(node.id) ?? 0 })),
  );
  return { placed, columns: count, rows: Math.max(0, ...lanes.map((lane) => lane.length)) };
}

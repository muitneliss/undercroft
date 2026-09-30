/**
 * The lineage view's decisions, without a word or a pixel: which nodes are upstream of the
 * selected model, what each model reads, and where each node sits in the layered drawing.
 *
 * The graph itself is the server's (`models.lineage`, ADR 0092), and it holds only what the
 * models declare. Nothing here adds an edge: "upstream" is the declared edges followed
 * backwards, and a node's column is the length of the longest declared chain below it. A
 * cycle -- which dbt refuses to build, and a saved text may still hold -- is followed once.
 *
 * The view lives in the Models division's own address (`?view=lineage&model=x`) rather than
 * under `/models/…`, where every segment is a model's name: a path segment named `lineage`
 * would shadow the model a customer is free to call that.
 */

import type { TFunction } from "i18next";

import type { LineageNode, ModelLineage } from "@/api/types.ts";
import { divisionPath } from "@/lib/divisions.ts";

export const VIEW_PARAM = "view";
export const LINEAGE_VIEW = "lineage";
export const MODEL_PARAM = "model";

type Edge = ModelLineage["edges"][number];

/** The lineage view's address, with `model` selected when one is given. */
export function lineagePath(tenantId: string, model: string | null = null): string {
  const params = new URLSearchParams({ [VIEW_PARAM]: LINEAGE_VIEW });
  if (model !== null) {
    params.set(MODEL_PARAM, model);
  }
  return `${divisionPath("models", tenantId)}?${params.toString()}`;
}

/** The model the address selects, if the graph has one by that name. */
export function selectedModel(graph: ModelLineage, params: URLSearchParams): LineageNode | null {
  const name = params.get(MODEL_PARAM);
  return graph.nodes.find((node) => node.kind === "model" && node.name === name) ?? null;
}

/** What `id` reads directly: the declared edges into it, the node itself left out. */
export function parentsOf(graph: ModelLineage, id: string): Edge[] {
  return graph.edges.filter((edge) => edge.to === id && edge.from !== id);
}

/** `id` and every node on a declared chain into it. */
export function upstreamOf(graph: ModelLineage, id: string): ReadonlySet<string> {
  const chain = new Set([id]);
  const queue = [id];
  for (let at = queue.shift(); at !== undefined; at = queue.shift()) {
    for (const edge of parentsOf(graph, at)) {
      if (!chain.has(edge.from)) {
        chain.add(edge.from);
        queue.push(edge.from);
      }
    }
  }
  return chain;
}

export interface Placed {
  readonly node: LineageNode;
  /** 0 for a raw lake table or a missing dependency; a model one past its deepest parent. */
  readonly column: number;
  readonly row: number;
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
 * Where every node sits: its column, and its row within the column. Rows follow the graph's
 * own order in the first column and, after it, the mean row of each node's parents, so a
 * model sits near what it reads and the drawn edges cross less.
 */
export function layout(graph: ModelLineage): Layout {
  const columns = columnsOf(graph);
  const count = Math.max(0, ...columns.values()) + 1;
  const rows = new Map<string, number>();
  const placed: Placed[] = [];
  for (let column = 0; column < count; column += 1) {
    const here = graph.nodes.filter((node) => columns.get(node.id) === column);
    const weight = new Map(here.map((node) => [node.id, parentRow(graph, rows, node.id)]));
    const ordered =
      column === 0
        ? here
        : [...here].sort(
            (a, b) =>
              (weight.get(a.id) ?? Number.POSITIVE_INFINITY) -
              (weight.get(b.id) ?? Number.POSITIVE_INFINITY),
          );
    for (const [row, node] of ordered.entries()) {
      rows.set(node.id, row);
      placed.push({ node, column, row });
    }
  }
  return { placed, columns: count, rows: Math.max(0, ...placed.map((p) => p.row + 1)) };
}

/** The mean row of a node's placed parents, or `null` for a node with none placed yet. */
function parentRow(
  graph: ModelLineage,
  rows: ReadonlyMap<string, number>,
  id: string,
): number | null {
  const placed = parentsOf(graph, id)
    .map((edge) => rows.get(edge.from))
    .filter((row) => row !== undefined);
  return placed.length === 0 ? null : placed.reduce((sum, row) => sum + row, 0) / placed.length;
}

/** Where the reader stands: the selected model, and the chain into it, when one is chosen. */
export interface Focus {
  readonly selected: LineageNode | null;
  readonly chain: ReadonlySet<string> | null;
}

export type NodeState = "selected" | "chain" | "dim" | "plain";

export function nodeState(focus: Focus, id: string): NodeState {
  if (focus.chain === null) {
    return "plain";
  }
  if (focus.selected?.id === id) {
    return "selected";
  }
  return focus.chain.has(id) ? "chain" : "dim";
}

/**
 * The words a node carries beside its name: what it is, and where it stands. The drawing and
 * the text list both print these, so a node on the selected chain says "upstream" in words
 * wherever it appears -- the dimming around it is never the only thing that carries that.
 */
export function nodeWords(t: TFunction, node: LineageNode, state: NodeState): string[] {
  const words: string[] = [];
  if (node.kind === "raw") {
    words.push(t("lineage.rawTable"));
  } else if (node.kind === "missing") {
    words.push(t("lineage.missing"));
  } else if (node.undeclared.length > 0) {
    words.push(t("lineage.undeclared"));
  }
  if (state === "selected") {
    words.push(t("lineage.selected"));
  } else if (state === "chain") {
    words.push(t("lineage.onChain"));
  }
  return words;
}

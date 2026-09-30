/**
 * The lineage view's decisions, without a pixel: which nodes are upstream and downstream of the
 * selected one, what each model reads, and the words a node carries. Where each node sits on
 * the board is `lineageLayout.ts`.
 *
 * The graph itself is the server's (`models.lineage`, ADR 0092), and it holds only what the
 * models declare. Nothing here adds an edge: "upstream" is the declared edges followed
 * backwards, "downstream" the same edges followed forwards, and a node's column is the length
 * of the longest declared chain below it. A cycle -- which dbt refuses to build, and a saved
 * text may still hold -- is followed once.
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
/** `?scope=related` draws only the selected node's chains; anything else draws every node. */
export const SCOPE_PARAM = "scope";
export const RELATED_SCOPE = "related";

type Edge = ModelLineage["edges"][number];

/**
 * The lineage view's address, with `model` selected when one is given, and narrowed to what is
 * related to it when `related` is set. Narrowing without a selection means nothing, so it is
 * dropped rather than carried into an address that would have to ignore it.
 */
export function lineagePath(
  tenantId: string,
  model: string | null = null,
  related = false,
): string {
  const params = new URLSearchParams({ [VIEW_PARAM]: LINEAGE_VIEW });
  if (model !== null) {
    params.set(MODEL_PARAM, model);
    if (related) {
      params.set(SCOPE_PARAM, RELATED_SCOPE);
    }
  }
  return `${divisionPath("models", tenantId)}?${params.toString()}`;
}

/** Whether the address narrows the drawing to the selected node's chains. */
export function isRelatedScope(params: URLSearchParams): boolean {
  return params.get(SCOPE_PARAM) === RELATED_SCOPE;
}

/**
 * The node the address selects, if the graph has one by that name. The parameter is still
 * called `model`, because that is what every link into the view already says; a raw lake
 * table or a missing dependency is selected by the same name it is drawn with. A model wins a
 * tie, which cannot happen in practice: a model's name has no dot and a raw table's does.
 */
export function selectedNode(graph: ModelLineage, params: URLSearchParams): LineageNode | null {
  const name = params.get(MODEL_PARAM);
  return (
    graph.nodes.find((node) => node.kind === "model" && node.name === name) ??
    graph.nodes.find((node) => node.name === name) ??
    null
  );
}

/** What `id` reads directly: the declared edges into it, the node itself left out. */
export function parentsOf(graph: ModelLineage, id: string): Edge[] {
  return graph.edges.filter((edge) => edge.to === id && edge.from !== id);
}

/** What reads `id` directly: the declared edges out of it, the node itself left out. */
export function childrenOf(graph: ModelLineage, id: string): Edge[] {
  return graph.edges.filter((edge) => edge.from === id && edge.to !== id);
}

/** `id` and every node one declared step at a time from it, each visited once. */
function reach(id: string, step: (at: string) => readonly string[]): ReadonlySet<string> {
  const chain = new Set([id]);
  const queue = [id];
  for (let at = queue.shift(); at !== undefined; at = queue.shift()) {
    for (const next of step(at)) {
      if (!chain.has(next)) {
        chain.add(next);
        queue.push(next);
      }
    }
  }
  return chain;
}

/** `id` and every node on a declared chain into it. */
export function upstreamOf(graph: ModelLineage, id: string): ReadonlySet<string> {
  return reach(id, (at) => parentsOf(graph, at).map((edge) => edge.from));
}

/** `id` and every node on a declared chain out of it: everything a failure of `id` reaches. */
export function downstreamOf(graph: ModelLineage, id: string): ReadonlySet<string> {
  return reach(id, (at) => childrenOf(graph, at).map((edge) => edge.to));
}

/** How many upstream paths the text writes out before it says there are more. */
export const PATH_LIMIT = 50;

/**
 * Every declared path into `id`, each from a node that reads nothing declared -- a raw lake
 * table, a missing dependency, a model whose upstream is not declared -- down to `id` itself.
 * A cycle is walked round once. Paths multiply with every join, so past `limit` the walk stops
 * and says so with `more`, rather than hand back a list that looks complete and is not.
 */
export function upstreamPaths(
  graph: ModelLineage,
  id: string,
  limit = PATH_LIMIT,
): { paths: string[][]; more: boolean } {
  const paths: string[][] = [];
  let more = false;
  function walk(at: string, below: readonly string[]): void {
    if (paths.length >= limit) {
      more = true;
      return;
    }
    const here = [at, ...below];
    const parents = parentsOf(graph, at)
      .map((edge) => edge.from)
      .filter((parent) => !here.includes(parent));
    if (parents.length === 0) {
      paths.push(here);
    }
    for (const parent of parents) {
      walk(parent, here);
    }
  }
  walk(id, []);
  return { paths, more };
}

/**
 * Where the reader stands: the selected node, the chain into it and the chain out of it, when
 * one is chosen.
 */
export interface Focus {
  readonly selected: LineageNode | null;
  readonly chain: ReadonlySet<string> | null;
  readonly downstream: ReadonlySet<string> | null;
}

export function focusOn(graph: ModelLineage, selected: LineageNode | null): Focus {
  return selected === null
    ? { selected, chain: null, downstream: null }
    : {
        selected,
        chain: upstreamOf(graph, selected.id),
        downstream: downstreamOf(graph, selected.id),
      };
}

/**
 * The graph as the drawing shows it: whole, or -- narrowed -- only the selected node's two
 * chains and the declared edges between them. Nothing is added; an edge is kept only when both
 * its ends are.
 */
export function drawnGraph(graph: ModelLineage, focus: Focus, related: boolean): ModelLineage {
  const { chain, downstream } = focus;
  if (!related || chain === null || downstream === null) {
    return graph;
  }
  const kept = new Set([...chain, ...downstream]);
  return {
    nodes: graph.nodes.filter((node) => kept.has(node.id)),
    edges: graph.edges.filter((edge) => kept.has(edge.from) && kept.has(edge.to)),
  };
}

export type NodeState = "selected" | "chain" | "downstream" | "dim" | "plain";

export function nodeState(focus: Focus, id: string): NodeState {
  if (focus.chain === null) {
    return "plain";
  }
  if (focus.selected?.id === id) {
    return "selected";
  }
  if (focus.chain.has(id)) {
    return "chain";
  }
  return focus.downstream?.has(id) === true ? "downstream" : "dim";
}

/** Whether a declared edge lies on the selected node's chain, and on which side of it. */
export function edgeState(focus: Focus, from: string, to: string): NodeState {
  if (focus.chain === null) {
    return "plain";
  }
  if (focus.chain.has(from) && focus.chain.has(to)) {
    return "chain";
  }
  return focus.downstream?.has(from) === true && focus.downstream.has(to) ? "downstream" : "dim";
}

/**
 * A column's heading, on the board and in the text list's levels alike. The first holds the raw
 * lake tables, and a missing dependency too, which has no chain below it to count; every later
 * column is how many steps it stands from them.
 */
export function laneLabel(t: TFunction, column: number, missing: boolean): string {
  if (column > 0) {
    return t("lineage.lane", { step: column });
  }
  return missing ? t("lineage.laneInputs") : t("lineage.laneRaw");
}

/**
 * The words a node carries beside its name: what it is, and where it stands. The drawing and
 * the text list both print these, so a node on the selected chain says "upstream" or
 * "downstream" in words wherever it appears -- the dimming around it is never the only thing
 * that carries that.
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
  const where = stateWord(t, state);
  if (where !== null) {
    words.push(where);
  }
  return words;
}

/** Where a node stands against the selection, in a word; nothing when it stands nowhere. */
export function stateWord(t: TFunction, state: NodeState): string | null {
  switch (state) {
    case "selected":
      return t("lineage.selected");
    case "chain":
      return t("lineage.onChain");
    case "downstream":
      return t("lineage.downstream");
    default:
      return null;
  }
}

type Undeclared = Extract<LineageNode, { kind: "model" }>["undeclared"][number];

/** One reason, worded: which declaration could not be read, and in which macro if not here. */
export function reasonText(t: TFunction, { code, subject, via }: Undeclared): string {
  const values = { subject: subject ?? "", via: via ?? "" };
  const here = via === null;
  switch (code) {
    case "dynamic-reference":
      return here ? t("lineage.reasonDynamic", values) : t("lineage.reasonDynamicVia", values);
    case "unknown-macro":
      return here
        ? t("lineage.reasonUnknownMacro", values)
        : t("lineage.reasonUnknownMacroVia", values);
    case "direct-read":
      return here ? t("lineage.reasonDirect", values) : t("lineage.reasonDirectVia", values);
    default:
      return here ? t("lineage.reasonQuery", values) : t("lineage.reasonQueryVia", values);
  }
}

/** What a node is, in a word: the heading of its card. */
export function kindWord(t: TFunction, node: LineageNode): string {
  switch (node.kind) {
    case "raw":
      return t("lineage.rawTable");
    case "missing":
      return t("lineage.missing");
    default:
      return t("lineage.model");
  }
}

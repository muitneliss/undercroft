/**
 * Where each card of the lineage board stands, and the line each declared edge is drawn along,
 * computed by the Eclipse Layout Kernel's layered algorithm (`elkjs`). ADR 0103.
 *
 * WHY A LAYOUT ENGINE. The board used to put every card at its column and its barycentre place
 * and join the two ends of an edge with one curve. On a real project of seventy models that
 * curve crossed the cards of every column between its ends: 195 of 242 wires ran over a card
 * that was not theirs, and a reader could not tell which card a wire entered. ELK routes an edge
 * that spans columns through the gaps between them, orders each column to cross fewer edges,
 * and places a card level with what it reads, so the same project draws with none.
 *
 * WHY THE COLUMNS ARE STILL OURS. A column is the longest declared chain below a node (ADR 0092,
 * `layout`), and ELK's own layering ranks by other measures. So every card is handed to ELK
 * already standing in its column, and ELK is told to keep the layers it is given (`INTERACTIVE`
 * layering, and cycle breaking that reverses only an edge pointing back across them). Only the
 * order within a column, the vertical places and the routes are ELK's.
 *
 * WHY IT IS KEPT, AND READ BY SUBSCRIPTION. ELK runs as a lazily loaded chunk -- half a megabyte
 * that only this board needs -- and answers asynchronously. Each pair of graphs is arranged once
 * and the answer kept, keyed by the graphs' identity: a memo of a pure function, holding nothing
 * a reader chose, so it is neither server state nor the store's (`.claude/rules/state.md`). The
 * board reads it through `useSyncExternalStore` rather than `use` and Suspense: selecting a node
 * is a router transition, and a transition that suspends holds the whole page -- picker, details
 * and text -- until ELK answers. Read this way, only the board waits.
 *
 * A layout ELK cannot produce is `null`, never a guessed one: the board then says it could not
 * be drawn, and the names and paths beneath it still say everything it would have.
 */

import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api.js";
import { useSyncExternalStore } from "react";

import type { ModelLineage } from "@/api/types.ts";
import { layout } from "@/lib/lineageLayout.ts";

/** A card's box. `.lineage-card` in `index.css` is the same size; the two are one number. */
export const CARD_W = 248;
export const CARD_H = 96;

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * An edge's line: its start, then a chain of cubic Bézier segments, each two control points and
 * the point it ends on. ELK draws splines this way, and `pathOf` turns one into an SVG path.
 */
export type Route = readonly Point[];

export interface Arrangement {
  /** Each drawn node's top-left corner, by node id. */
  readonly cards: ReadonlyMap<string, Point>;
  /** Each column that has a card, with the left edge of its cards. */
  readonly columns: readonly { readonly column: number; readonly x: number }[];
  /** The top edge of the highest card. */
  readonly top: number;
  /** Each drawn edge's line, by `${from}|${to}`. A self-reference is not drawn and has none. */
  readonly routes: ReadonlyMap<string, Route>;
}

/** The gap between two columns' cards, and between two cards in one column. */
const GAP_X = 88;
const GAP_Y = 28;

const OPTIONS = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.padding": "[top=0,left=0,bottom=0,right=0]",
  // One layout for the whole board. ELK otherwise lays out each disconnected part on its own,
  // every part starting at its own first layer, and a model with no declared upstream drifted
  // left into the raw lake's column.
  "elk.separateConnectedComponents": "false",
  "elk.layered.cycleBreaking.strategy": "INTERACTIVE",
  "elk.layered.layering.strategy": "INTERACTIVE",
  // Network simplex keeps a chain level and the drawing compact; Brandes-Köpf drew the same
  // project half as tall again.
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
  // Splines, not orthogonal: seventy models' orthogonal wires run as one grid of parallel
  // lines, and merging them into buses would ink a whole trunk for one selected chain.
  "elk.edgeRouting": "SPLINES",
  "elk.spacing.nodeNode": String(GAP_Y),
  "elk.layered.spacing.nodeNodeBetweenLayers": String(GAP_X),
};

export function edgeId(from: string, to: string): string {
  return `${from}|${to}`;
}

/** The SVG path of a route. */
export function pathOf(route: Route): string {
  const [start, ...rest] = route;
  if (start === undefined) {
    return "";
  }
  let path = `M${String(start.x)},${String(start.y)}`;
  for (const [at, point] of rest.entries()) {
    path += `${at % 3 === 0 ? " C" : " "}${String(point.x)},${String(point.y)}`;
  }
  return path;
}

function routeOf(edge: ElkExtendedEdge): Route | undefined {
  const [section] = edge.sections ?? [];
  return section === undefined
    ? undefined
    : [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
}

/**
 * The arrangement of `drawn`, the part of `graph` on the board (`drawnGraph`), or `null` when ELK
 * could not produce one. Columns are read off the whole graph, as `layout` reads them.
 */
export async function arrange(
  graph: ModelLineage,
  drawn: ModelLineage,
): Promise<Arrangement | null> {
  const columnOf = new Map(layout(graph, drawn).placed.map((p) => [p.node.id, p.column]));
  const root: ElkNode = {
    id: "lineage",
    layoutOptions: OPTIONS,
    children: drawn.nodes.map((node) => ({
      id: node.id,
      width: CARD_W,
      height: CARD_H,
      // The column, as a place ELK's interactive layering reads back as the layer.
      x: (columnOf.get(node.id) ?? 0) * (CARD_W + GAP_X),
      y: 0,
    })),
    edges: drawn.edges
      .filter((edge) => edge.from !== edge.to)
      .map((edge) => ({
        id: edgeId(edge.from, edge.to),
        sources: [edge.from],
        targets: [edge.to],
      })),
  };
  // Outside the `try`: a chunk a deploy took away is thrown to `StaleChunkBoundary`.
  const { default: Elk } = await import("elkjs/lib/elk.bundled.js");
  let laid: ElkNode;
  try {
    laid = await new Elk().layout(root);
  } catch {
    return null;
  }

  const cards = new Map(
    (laid.children ?? []).map((card) => [card.id, { x: card.x ?? 0, y: card.y ?? 0 }]),
  );
  const lefts = new Map<number, number>();
  for (const [id, at] of cards) {
    const column = columnOf.get(id) ?? 0;
    lefts.set(column, Math.min(lefts.get(column) ?? at.x, at.x));
  }
  const routes = new Map<string, Route>();
  for (const edge of laid.edges ?? []) {
    const route = routeOf(edge);
    if (route !== undefined) {
      routes.set(edge.id, route);
    }
  }
  return {
    cards,
    columns: [...lefts].map(([column, x]) => ({ column, x })).sort((a, b) => a.column - b.column),
    top: Math.min(...[...cards.values()].map((at) => at.y)),
    routes,
  };
}

/** One pair of graphs being arranged: its answer once ELK gives one, and who is waiting for it. */
interface Arranging {
  /** `undefined` while ELK works. */
  answer: Arrangement | null | undefined;
  /** A chunk that would not load, thrown where the board renders. */
  failure: { readonly error: unknown } | null;
  readonly subscribe: (changed: () => void) => () => void;
}

const kept = new WeakMap<ModelLineage, WeakMap<ModelLineage, Arranging>>();

function arranging(graph: ModelLineage, drawn: ModelLineage): Arranging {
  const byDrawn = kept.get(graph) ?? new WeakMap<ModelLineage, Arranging>();
  kept.set(graph, byDrawn);
  const known = byDrawn.get(drawn);
  if (known !== undefined) {
    return known;
  }
  const waiting = new Set<() => void>();
  const made: Arranging = {
    answer: undefined,
    failure: null,
    subscribe: (changed) => {
      waiting.add(changed);
      return (): void => {
        waiting.delete(changed);
      };
    },
  };
  byDrawn.set(drawn, made);
  arrange(graph, drawn).then(
    (answer) => {
      made.answer = answer;
      for (const changed of waiting) {
        changed();
      }
    },
    (error: unknown) => {
      made.failure = { error };
      for (const changed of waiting) {
        changed();
      }
    },
  );
  return made;
}

/**
 * `arrange` for the board: `undefined` while ELK works. Each pair of graphs is arranged once,
 * however many times the board renders it.
 */
export function useArrangement(
  graph: ModelLineage,
  drawn: ModelLineage,
): Arrangement | null | undefined {
  const held = arranging(graph, drawn);
  const answer = useSyncExternalStore(held.subscribe, () => held.answer);
  if (held.failure !== null) {
    throw held.failure.error;
  }
  return answer;
}

/**
 * A node-and-edge drawing as a village (ADR 0115): every node one building, every edge one road,
 * and a road carrying traffic exactly when its edge flows.
 *
 * The interface draws two graphs: a run's stages (`runFlow.ts`) and the models' lineage
 * (`lineage.ts`). Both used to be React Flow boards; both are villages now, and this module is
 * the one place that turns either into what the village builds. It adds nothing and drops
 * nothing: `village.test.ts` holds that the buildings are exactly the graph's nodes, the roads
 * exactly its edges, and the traffic exactly its flowing edges, by the same rules the boards
 * used (a run's link flows out of a stage still working; a lineage wire flows along the selected
 * node's chains).
 *
 * Positions are world units on the board (`layout.ts`'s scale: a hex tile is 2 across). A
 * lineage keeps ELK's arrangement (`lineageArrange.ts`), scaled from its pixels, so the village
 * stands where the board's cards stood and every road runs along the line ELK routed.
 */

import type { LineageNode, ModelItem, ModelLineage } from "@/api/types.ts";
import type { DivisionId } from "@/lib/divisions.ts";
import { edgeState, type Focus, nodeState } from "@/lib/lineage.ts";
import { type Arrangement, CARD_H, CARD_W, edgeId, type Route } from "@/lib/lineageArrange.ts";
import { buildMark } from "@/lib/modelBuild.ts";
import type { RunStage, StageKind } from "@/lib/runFlowTypes.ts";
import type { Point } from "@/lib/village/layout.ts";

/** What a node stands for, which decides the building it is. */
export type GraphNodeKind = Exclude<StageKind, "link-parent" | "link-child"> | LineageNode["kind"];

/** How a node or an edge is drawn: as the board inked, dotted or dimmed it. */
export type GraphState = "selected" | "chain" | "downstream" | "dim" | "plain";

export interface GraphNode extends Point {
  readonly id: string;
  readonly kind: GraphNodeKind;
  /** The division whose hue its roof wears. */
  readonly division: DivisionId;
  readonly state: GraphState;
  /** An errata slip stands by it: a stage that stopped, a model whose last build failed. */
  readonly slip: boolean;
  /** Its name, for the words beside the picture; the canvas draws none. */
  readonly name: string;
}

export interface GraphEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly state: GraphState;
  /** Whether traffic moves along it now. */
  readonly flowing: boolean;
  /** It comes from a dependency that no longer exists: drawn broken, as the board drew it. */
  readonly broken: boolean;
  /** The road's line, from the source building to the target's, in world units. */
  readonly path: readonly Point[];
}

export interface VillageGraph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  /** Who walks a flowing road: a courier on a run's, a cart on the lineage's. */
  readonly carrier: "figure" | "cart";
}

/** How far apart a run's stages stand along its road. */
const STAGE_SPACING = 4.4;
/**
 * World units per pixel of ELK's arrangement. ELK spaces cards for a card's size; a building is
 * deeper than a card is tall, so the board is laid out larger than the cards were.
 */
const PIXEL = 1 / 50;
/** Points sampled along each cubic segment of a routed edge. */
const CURVE_STEPS = 8;

const STAGE_DIVISION: Readonly<Record<GraphNodeKind, DivisionId>> = {
  entity: "sources",
  outcome: "journal",
  models: "models",
  lake: "lake",
  model: "models",
  raw: "lake",
  missing: "models",
};

/**
 * A run's own stages as a village: one building per stage along a road, in the order they
 * happen. The chain links are not drawn: they belong to the runs on the other side of them, and
 * are slips in words beside the picture.
 */
/** A stage of the run's own, not a link to another run's. */
type OwnStage = RunStage & { readonly kind: Exclude<StageKind, "link-parent" | "link-child"> };

function isOwn(stage: RunStage): stage is OwnStage {
  return stage.kind !== "link-parent" && stage.kind !== "link-child";
}

export function runMapGraph(stages: readonly RunStage[]): VillageGraph {
  const own = stages.filter(isOwn);
  const start = -((own.length - 1) * STAGE_SPACING) / 2;
  const nodes: GraphNode[] = own.map((stage, at) => ({
    id: stage.key,
    kind: stage.kind,
    division: STAGE_DIVISION[stage.kind],
    state: "plain",
    slip: stage.mark === "lapsed",
    name: stage.label,
    x: start + at * STAGE_SPACING,
    z: 0,
  }));
  const edges: GraphEdge[] = [];
  for (let at = 1; at < own.length; at += 1) {
    const from = own[at - 1];
    const to = own[at];
    const a = nodes[at - 1];
    const b = nodes[at];
    if (from !== undefined && to !== undefined && a !== undefined && b !== undefined) {
      edges.push({
        id: `${from.key}->${to.key}`,
        from: from.key,
        to: to.key,
        state: "plain",
        // The board's rule: the link out of a stage still working carries the work.
        flowing: from.mark === "pending",
        broken: false,
        path: [a, b],
      });
    }
  }
  return { nodes, edges, carrier: "figure" };
}

/** A cubic Bézier's value at `t`, from its start, two control values and its end. */
function cubic([a, b, c, d]: readonly [number, number, number, number], t: number): number {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}

/** An ELK route as world points: its start, then each cubic segment sampled. */
function routePath(route: Route): Point[] {
  const [start, ...rest] = route;
  if (start === undefined) {
    return [];
  }
  const points: Point[] = [{ x: start.x * PIXEL, z: start.y * PIXEL }];
  let from = start;
  for (let at = 0; at + 2 < rest.length; at += 3) {
    const [c1, c2, end] = [rest[at], rest[at + 1], rest[at + 2]];
    if (c1 === undefined || c2 === undefined || end === undefined) {
      break;
    }
    for (let step = 1; step <= CURVE_STEPS; step += 1) {
      const t = step / CURVE_STEPS;
      points.push({
        x: cubic([from.x, c1.x, c2.x, end.x], t) * PIXEL,
        z: cubic([from.y, c1.y, c2.y, end.y], t) * PIXEL,
      });
    }
    from = end;
  }
  return points;
}

function centreOf(arrangement: Arrangement, id: string): Point {
  const card = arrangement.cards.get(id) ?? { x: 0, y: 0 };
  return { x: (card.x + CARD_W / 2) * PIXEL, z: (card.y + CARD_H / 2) * PIXEL };
}

/**
 * The lineage as a village: a building per drawn node where ELK placed its card, a road per
 * declared edge along the line ELK routed, and traffic on the selected node's chains -- the
 * wires the board animated. A self-reference has no road, as it had no wire.
 */
export function lineageGraph(
  drawn: ModelLineage,
  focus: Focus,
  arrangement: Arrangement,
  builds: ReadonlyMap<string, ModelItem>,
): VillageGraph {
  const nodes: GraphNode[] = drawn.nodes.map((node) => ({
    id: node.id,
    kind: node.kind,
    division: STAGE_DIVISION[node.kind],
    state: nodeState(focus, node.id),
    slip:
      node.kind === "missing" ||
      (node.kind === "model" &&
        buildMark(builds.get(node.name)?.lastBuild?.status ?? null) === "lapsed"),
    name: node.name,
    ...centreOf(arrangement, node.id),
  }));
  const missing = new Set(drawn.nodes.filter((n) => n.kind === "missing").map((n) => n.id));
  const edges: GraphEdge[] = drawn.edges
    .filter((edge) => edge.from !== edge.to)
    .map((edge) => {
      const id = edgeId(edge.from, edge.to);
      const state = edgeState(focus, edge.from, edge.to);
      const route = arrangement.routes.get(id);
      return {
        id,
        from: edge.from,
        to: edge.to,
        state,
        flowing: state === "chain" || state === "downstream",
        broken: missing.has(edge.from),
        // ELK routes from a card's edge to the next card's; a building is narrower than a card,
        // so the road is carried on from the source building's middle to the target's.
        path: [
          centreOf(arrangement, edge.from),
          ...(route === undefined ? [] : routePath(route)),
          centreOf(arrangement, edge.to),
        ],
      };
    });
  return { nodes, edges, carrier: "cart" };
}

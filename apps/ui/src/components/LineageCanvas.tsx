/**
 * The lineage drawn: a card per node on a board the reader pans, zooms and rearranges, the
 * declared edges between them, the selected node's upstream chain inked, its downstream chain
 * dotted, and everything else dimmed. ADR 0097, superseding ADR 0092's fixed grid.
 *
 * WHY A BOARD AND NOT THE GRID. The grid shared the leaf's width between its columns, so a real
 * project -- sixty models, twenty in one column -- cut every name to seven characters and drew
 * its edges as one thicket. A card here is as wide as a name needs, the columns stand as far
 * apart as the edges need, and the page's width decides neither. Each column carries a heading
 * saying how far it stands from the raw lake, because that is what a column is (`layout`).
 * Where each card stands within its column, and the line each edge runs along, are ELK's
 * (`arrange`, ADR 0103), so a wire that spans columns passes between their cards, not over them.
 *
 * WHERE A DRAGGED CARD'S PLACE LIVES. In `@xyflow/react`'s own store: the board is handed its
 * cards once, as `defaultNodes`, and owns their places from then on. A dragged place is the
 * drawing's working state, like a scroll offset -- no other component reads it and nothing keeps
 * it -- so it is neither server state nor the Zustand store's (`.claude/rules/state.md`).
 * "Reset layout" puts every card back. The board is remounted by key whenever what it draws
 * changes, so a card is never left at a place computed for a different graph. A wire keeps the
 * line ELK routed only while both its cards stand where ELK put them; once either is dragged it
 * is drawn as a plain curve between them, since the routed line no longer meets the card.
 *
 * THE KEYBOARD. Each card is a real <button> that selects it, and the library's own node focus
 * is off, so a card is one tab stop, not two. The picker above the board and the text beneath
 * it reach every node too, and name every chain and path in words.
 *
 * It draws only what `models.lineage` returned; there is nothing here that could add an edge.
 */

import type { EdgeTypes, Node, NodeTypes } from "@xyflow/react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
} from "@xyflow/react";
import type { TFunction } from "i18next";
import { type RefObject, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { ModelItem, ModelLineage as Graph } from "@/api/types.ts";
import {
  Card,
  type CardNode,
  Head,
  type HeadNode,
  Wire,
  type WireEdge,
} from "@/components/LineageCards.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { useFullscreen } from "@/lib/fullscreen.ts";
import { type Focus, laneLabel, nodeState } from "@/lib/lineage.ts";
import { type Arrangement, CARD_H, CARD_W, edgeId, useArrangement } from "@/lib/lineageArrange.ts";
import { BoardContext } from "@/lib/lineageBoard.ts";

const NODE_TYPES: NodeTypes = { card: Card, head: Head };
const EDGE_TYPES: EdgeTypes = { wire: Wire };

/** How far a column's heading stands above the highest card. */
const HEAD_GAP = 64;
const HEAD_H = 32;
/**
 * How a fitted view frames what it fits: never enlarged past life size, and never shrunk past
 * where a card's name can still be read. A project too big for the board at that floor is
 * fitted from its middle, and the reader pans to the rest -- the mini map says where they are.
 * Fitting all of a sixty-model project at once drew every name as a grey smear, and so did a
 * floor of 0.6: a card's caption came out at six pixels.
 */
const FIT = { padding: 0.12, minZoom: 0.85, maxZoom: 1 } as const;

/** Every card at the place `arrange` gives it, and a heading over every column that has one. */
function toNodes(t: TFunction, drawn: Graph, arrangement: Arrangement): Node[] {
  const cards: CardNode[] = drawn.nodes.map((node) => ({
    id: node.id,
    type: "card",
    position: arrangement.cards.get(node.id) ?? { x: 0, y: 0 },
    data: { node },
    width: CARD_W,
    height: CARD_H,
    focusable: false,
    selectable: false,
    connectable: false,
  }));
  // A missing dependency stands in the first column, beside the raw lake tables.
  const missing = drawn.nodes.some((node) => node.kind === "missing");
  const heads: HeadNode[] = arrangement.columns.map(({ column, x }) => ({
    id: `head:${String(column)}`,
    type: "head",
    position: { x, y: arrangement.top - HEAD_GAP },
    data: { label: laneLabel(t, column, missing) },
    width: CARD_W,
    height: HEAD_H,
    draggable: false,
    focusable: false,
    selectable: false,
    connectable: false,
  }));
  return [...heads, ...cards];
}

function toEdges(drawn: Graph, arrangement: Arrangement): WireEdge[] {
  const missing = new Set(drawn.nodes.filter((n) => n.kind === "missing").map((n) => n.id));
  return drawn.edges
    .filter((edge) => edge.from !== edge.to)
    .map((edge) => {
      const id = edgeId(edge.from, edge.to);
      const route = arrangement.routes.get(id);
      const from = arrangement.cards.get(edge.from);
      const to = arrangement.cards.get(edge.to);
      return {
        id,
        source: edge.from,
        target: edge.to,
        type: "wire",
        data: {
          missing: missing.has(edge.from),
          routed:
            route === undefined || from === undefined || to === undefined
              ? null
              : { route, from, to },
        },
        // Drawn into a shared <defs>, outside the edge's class, so its colour cannot come from
        // the stylesheet: `--ink-2`'s own value, as the run map's arrow does.
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "#56513f" },
        focusable: false,
        selectable: false,
      };
    });
}

/**
 * Bring the selection into view: the selected node and both its chains, or the whole drawing
 * when nothing is selected. Instant rather than eased -- nothing in this sheet eases (ADR 0014).
 */
function FollowSelection({ ids }: { ids: string }): null {
  const { fitView } = useReactFlow();
  const ready = useNodesInitialized();
  useEffect(() => {
    if (!ready) {
      return;
    }
    const nodes = ids === "" ? undefined : ids.split("\n").map((id) => ({ id }));
    void fitView({ ...FIT, ...(nodes === undefined ? {} : { nodes }) });
  }, [ids, ready, fitView]);
  return null;
}

/**
 * The board's own furniture: the zoom plates, the mini map, the way back to the layout, and the
 * way to full screen -- for the bench, not the board alone, so the details stay beside it.
 */
function Furniture({
  nodes,
  focus,
  bench,
}: {
  nodes: Node[];
  focus: Focus;
  bench: RefObject<HTMLElement | null>;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { setNodes, fitView } = useReactFlow();
  const screen = useFullscreen(bench);
  return (
    <>
      <Background gap={18} size={1} variant={BackgroundVariant.Dots} />
      <Controls showInteractive={false} />
      <MiniMap
        nodeClassName={(node): string =>
          node.type === "head"
            ? "lineage-mini--head"
            : `lineage-mini lineage-mini--${nodeState(focus, node.id)}`
        }
        pannable={true}
        zoomable={true}
      />
      <Panel className="row" position="top-right">
        {screen.available ? (
          <button
            aria-pressed={screen.on}
            className="plate plate--small"
            onClick={screen.toggle}
            type="button"
          >
            {screen.on ? t("lineage.exitFullscreen") : t("lineage.fullscreen")}
          </button>
        ) : null}
        <button
          className="plate plate--small"
          onClick={(): void => {
            setNodes(nodes);
            void fitView(FIT);
          }}
          type="button"
        >
          {t("lineage.resetLayout")}
        </button>
      </Panel>
    </>
  );
}

interface BoardProps {
  graph: Graph;
  /** The part of `graph` on the board: all of it, or the selection's chains. */
  drawn: Graph;
  focus: Focus;
  builds: ReadonlyMap<string, ModelItem>;
  select: (name: string | null) => void;
  /** The board and its details together: what full screen fills. */
  bench: RefObject<HTMLElement | null>;
}

/** The board, once ELK has arranged it; its place is held while ELK works. */
export function LineageCanvas(props: BoardProps): React.JSX.Element {
  const { t } = useTranslation();
  const arrangement = useArrangement(props.graph, props.drawn);
  return (
    <figure aria-label={t("lineage.drawingLabel")} className="lineage-board">
      {arrangement === undefined ? <Skeleton rows={6} /> : null}
      {arrangement === null ? <p className="note">{t("lineage.notArranged")}</p> : null}
      {arrangement === undefined || arrangement === null ? null : (
        <Arranged {...props} arrangement={arrangement} />
      )}
    </figure>
  );
}

function Arranged({
  graph,
  drawn,
  focus,
  builds,
  select,
  bench,
  arrangement,
}: BoardProps & { arrangement: Arrangement }): React.JSX.Element {
  const { t } = useTranslation();
  const nodes = useMemo(() => toNodes(t, drawn, arrangement), [t, drawn, arrangement]);
  const edges = useMemo(() => toEdges(drawn, arrangement), [drawn, arrangement]);
  const board = useMemo(() => ({ graph, focus, builds, select }), [graph, focus, builds, select]);
  // What the board draws, as one string: a change of it remounts the board with fresh places.
  const shape = [...drawn.nodes.map((n) => n.id), ...edges.map((e) => e.id)].join("\n");
  const followed =
    focus.chain === null
      ? ""
      : [...new Set([...focus.chain, ...(focus.downstream ?? [])])].join("\n");
  const labels = {
    "controls.ariaLabel": t("lineage.controls"),
    "controls.zoomIn.ariaLabel": t("lineage.zoomIn"),
    "controls.zoomOut.ariaLabel": t("lineage.zoomOut"),
    "controls.fitView.ariaLabel": t("lineage.fitView"),
    "minimap.ariaLabel": t("lineage.minimap"),
  };

  return (
    <BoardContext.Provider value={board}>
      <ReactFlowProvider key={shape}>
        <ReactFlow
          ariaLabelConfig={labels}
          defaultEdges={edges}
          defaultNodes={nodes}
          edgesFocusable={false}
          edgeTypes={EDGE_TYPES}
          elementsSelectable={false}
          fitView={true}
          fitViewOptions={FIT}
          maxZoom={2}
          minZoom={0.1}
          nodesConnectable={false}
          nodesFocusable={false}
          nodeTypes={NODE_TYPES}
          onPaneClick={(): void => {
            select(null);
          }}
          // The credit pill floats over the drawing, which this system has no object for;
          // `@xyflow/react` is MIT, which asks for it, not requires it. The run map does the same.
          proOptions={{ hideAttribution: true }}
        >
          <Furniture bench={bench} focus={focus} nodes={nodes} />
          <FollowSelection ids={followed} />
        </ReactFlow>
      </ReactFlowProvider>
    </BoardContext.Provider>
  );
}

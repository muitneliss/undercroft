/**
 * The run's own shape, drawn: one plate per stage, left to right in the order they happen,
 * with the work flowing along the connection between them while the run is still going.
 *
 * WHAT EACH PLATE SAYS, in the order the eye takes it: the stage's name in caps, then the
 * figure it landed set large in the machine face -- the loudest line on the plate, because
 * "did my data come in, and how much" is the question this leaf exists to answer -- then the
 * status mark, whose geometry carries the state before its word or its hue does.
 *
 * THREE PLATES, NOT ONE REPEATED. A stage of work is a leaf. The run's own verdict is the
 * stamp that closes the ledger, so it is inked, the one solid object in the row. A stage
 * that stopped is an errata slip, in the same vermilion-ruled language a correction wears
 * everywhere else in this interface. That is what keeps a row of plates from being the grid
 * of equal cards `DESIGN.md` bans: the three are different objects, not one card recoloured.
 *
 * THE CONNECTION IS ALIVE WHILE THE RUN IS. An edge out of a finished stage is a settled
 * rule; an edge out of a stage still working flows, which is the one honest live signal the
 * drawing has and the thing that tells an operator mid-call that something is happening
 * without them reading a number. Arrowheads carry the direction so the row reads as a
 * sequence rather than a set.
 *
 * THE CANVAS IS `aria-hidden`, and it draws this run's own stages only. Everything on it is
 * said in words elsewhere on this leaf: `RunEvents` beside it narrates the same feed as
 * sentences, and the counts table below prints the same figures. A chain link is different
 * -- it is the only route to another run -- so it is not drawn on the canvas at all. It is a
 * continuation slip above or below, in real, focusable text, printed once. It used to be
 * printed twice, as a dashed plate on the canvas and again as a line beneath it.
 *
 * Of `@xyflow/react`'s own look nothing survives but the things it is actually good at: node
 * placement, the edge paths, the markers and the flow animation. No grid, no minimap, no
 * zoom or pan -- this is a schedule, not an infinite canvas. Its attribution is kept and
 * linked, set as a colophon in this system's voice rather than floating over the drawing.
 */

import type { Edge, Node, NodeProps, NodeTypes } from "@xyflow/react";
import { Handle, MarkerType, Position, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import type { RunDetail, RunEventView } from "@/api/types.ts";
import { ArrowLeft, ArrowRight } from "@/components/Icon.tsx";
import { StatusMark } from "@/components/StatusMark.tsx";
import { divisionPath } from "@/lib/divisions.ts";
import { deriveRunFlow, type RunStage } from "@/lib/runFlow.ts";
import { type Place, railPlan, railWidth, STATION_HEIGHT } from "@/lib/runFlowLayout.ts";
import type { Locale } from "@undercroft/core/locale";

interface StationData {
  readonly stage: RunStage;
  readonly place: Place;
  // `@xyflow/react`'s Node<T> requires its data to be indexable; the two fields above are
  // still exactly typed, this only admits the shape to that constraint.
  readonly [key: string]: unknown;
}

type StationNode = Node<StationData, "station">;

/**
 * Which of the three plates a stage is printed as. The stamp is for a verdict that actually
 * closed: a run that failed is a correction, and a run still going has no verdict to stamp
 * yet -- inking either one claims a settled outcome the run has not reached.
 */
function plateKind(stage: RunStage): "errata" | "stamp" | "work" {
  if (stage.mark === "lapsed") {
    return "errata";
  }
  return stage.kind === "outcome" && stage.mark === "granted" ? "stamp" : "work";
}

function Station({ data }: NodeProps<StationNode>): React.JSX.Element {
  const { stage, place } = data;
  const classes = [
    "run-plate",
    `run-plate--${plateKind(stage)}`,
    `run-plate--${stage.mark}`,
    `run-plate--${place}`,
  ].join(" ");
  return (
    <div className={classes}>
      {/* A connector is drawn only where something is actually wired to it. The first plate
          has nothing arriving and the last has nothing leaving; both used to show a punched
          hole anyway, connected to nothing. */}
      <Handle
        type="target"
        position={Position.Left}
        className="run-plate__in"
        isConnectable={false}
      />

      <span className="run-plate__name">{stage.label}</span>
      {stage.detail === null ? null : <span className="run-plate__datum">{stage.detail}</span>}
      <StatusMark mark={stage.mark} label={stage.markLabel} />

      <Handle
        type="source"
        position={Position.Right}
        className="run-plate__out"
        isConnectable={false}
      />
    </div>
  );
}

const NODE_TYPES: NodeTypes = { station: Station };

function toNodes(stages: readonly RunStage[]): StationNode[] {
  return railPlan(stages).map((station) => ({
    id: station.stage.key,
    type: "station",
    position: { x: station.x, y: 0 },
    data: { stage: station.stage, place: station.place },
    width: station.width,
    height: STATION_HEIGHT,
    draggable: false,
    selectable: false,
    focusable: false,
  }));
}

/**
 * The connection from one plate to the next. It belongs to the stage behind it: work still
 * moving along it flows, work that has settled does not, and work that stopped never
 * travelled it at all.
 */
function toEdges(stages: readonly RunStage[]): Edge[] {
  const edges: Edge[] = [];
  for (let i = 1; i < stages.length; i += 1) {
    const from = stages[i - 1];
    const to = stages[i];
    if (from !== undefined && to !== undefined) {
      edges.push({
        id: `${from.key}->${to.key}`,
        source: from.key,
        target: to.key,
        // Straight, because the row is one line and every plate sits at the same y: a
        // smoothstep path on a horizontal run only adds joints for the renderer to round.
        type: "straight",
        animated: from.mark === "pending",
        className: `run-link run-link--${from.mark}`,
        // The marker is drawn into a shared <defs>, outside this edge's class, so its
        // colour cannot come from the stylesheet the way the path's does. Ink 2 as a
        // literal, matching `--ink-2`'s own value at the top of `index.css`.
        markerEnd: { type: MarkerType.ArrowClosed, width: 13, height: 13, color: "#56513f" },
        focusable: false,
        selectable: false,
        reconnectable: false,
      });
    }
  }
  return edges;
}

/**
 * One chain link: the run this one came from, or the one it started. Printed once, in real
 * text with a real `href`. `into` is the direction the reader travels.
 */
function ChainSlip({
  stage,
  into,
}: {
  stage: RunStage | undefined;
  into: "from" | "onto";
}): React.JSX.Element | null {
  if (stage === undefined || stage.href === null) {
    return null;
  }
  const Arrow = into === "from" ? ArrowLeft : ArrowRight;
  return (
    <p className={`run-chain run-chain--${into}`}>
      <Link className="run-chain__link" to={stage.href}>
        <Arrow size={13} />
        {stage.label}
      </Link>
      <StatusMark mark={stage.mark} label={stage.markLabel} />
    </p>
  );
}

function runHrefIn(tenantId: string): (runId: string) => string {
  return (runId: string): string => `${divisionPath("journal", tenantId)}/${runId}`;
}

export function RunFlow({
  tenantId,
  run,
  events,
  locale,
}: {
  tenantId: string;
  run: RunDetail;
  events: readonly RunEventView[];
  locale: Locale;
}): React.JSX.Element {
  const { t } = useTranslation();

  const stages = useMemo(
    () => deriveRunFlow(t, locale, { run, events, runHref: runHrefIn(tenantId) }),
    [t, locale, run, events, tenantId],
  );

  // The canvas draws this run's own stages; a chain link is a slip beside it, not a plate on
  // it -- it belongs to the run on the other side of it.
  const own = useMemo(
    () => stages.filter((stage) => stage.kind !== "link-parent" && stage.kind !== "link-child"),
    [stages],
  );
  const nodes = useMemo(() => toNodes(own), [own]);
  const edges = useMemo(() => toEdges(own), [own]);
  const width = useMemo(() => railWidth(railPlan(own)), [own]);

  return (
    <div className="run-map stack stack--tight">
      <span className="label">{t("journal.flow.head")}</span>

      <ChainSlip stage={stages.find((stage) => stage.kind === "link-parent")} into="from" />

      <div className="run-map__canvas" aria-hidden="true">
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            defaultViewport={{ x: 4, y: 8, zoom: 1 }}
            minZoom={1}
            maxZoom={1}
            panOnDrag={false}
            panOnScroll={false}
            zoomOnScroll={false}
            zoomOnPinch={false}
            zoomOnDoubleClick={false}
            preventScrolling={false}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            // Set as the colophon line below instead, in this system's own voice: the credit
            // ships either way, and a floating pill is a thing this system has none of.
            proOptions={{ hideAttribution: true }}
            style={{ width }}
          />
        </ReactFlowProvider>
      </div>

      <ChainSlip stage={stages.find((stage) => stage.kind === "link-child")} into="onto" />

      <p className="run-map__colophon">
        <a href="https://reactflow.dev" target="_blank" rel="noreferrer">
          {t("journal.flow.drawnWith", { name: "React Flow" })}
        </a>
      </p>
    </div>
  );
}

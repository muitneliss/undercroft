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
 * THE DRAWING HAS A GROUND. The canvas used to be transparent, which left the plates lying
 * on the reading field with nothing under them -- a row of objects rather than a drawing OF
 * something, and the reason the figure read flat however well each plate was cut. It is now
 * the page stock inside one keyline, carrying a registration grid: the marks a press prints
 * to align a sheet, which is this system's own object for "a surface something is drawn on".
 * That grid is `index.css`'s, drawn as a background on the scroll container; `@xyflow/react`'s
 * own `<Background>` is still not used, and neither is its minimap, zoom or pan -- this is a
 * schedule, not an infinite canvas.
 *
 * Of `@xyflow/react`'s own look nothing survives but the things it is actually good at: node
 * placement, the edge paths, the markers and the flow animation. Its attribution is kept and
 * linked, set as a colophon in this system's voice rather than floating over the drawing.
 */

import type { Edge, Node, NodeProps, NodeTypes } from "@xyflow/react";
import {
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useUpdateNodeInternals,
} from "@xyflow/react";
import { useEffect, useMemo, useRef } from "react";
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

      {/* How far this stage has got, inked along its own foot -- the drawing of the figure
          `RunProgress` states in words below the canvas. Absolutely positioned and SCALED
          rather than widened, so a reading that changes every second cannot move the plate's
          box: the handle positions `RemeasurePlates` exists to keep honest are measured from
          it. `gathered` is null wherever the fraction would be invented (`runFlowTypes.ts`). */}
      {stage.gathered === null ? null : (
        <span className="run-plate__gathered">
          <span
            className="run-plate__gathered-ink"
            style={{ transform: `scaleX(${stage.gathered})` }}
          />
        </span>
      )}

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

/**
 * Where the row sits in its field.
 *
 * Centred rather than pinned to the corner: the canvas is 44px taller than a plate, so 22
 * puts the row on the field's own centre line, and 20 gives the first plate the same margin
 * from the keyline that the last one gets from the trailing gap `railWidth` already reserves.
 * Both are pinned against `--station-h` and the canvas height in `index.css`.
 */
const DRAWING_ORIGIN = { x: 20, y: 22, zoom: 1 } as const;

/**
 * Re-measure every plate's connectors once the row has actually finished laying out.
 *
 * @xyflow/react measures each handle ONCE, as the node mounts, and places that node's edge
 * endpoints from the numbers it read then. Anything that changes the plate's box afterwards
 * leaves those numbers describing a layout that no longer exists, and the edge is drawn to
 * where the connector used to be -- the skewed line this exists to prevent. Its own docs name
 * the remedy: "when changing handle positions, call the updateNodeInternals function to
 * notify React Flow of the layout changes".
 *
 * THE LEAF IS TURNING WHILE THIS MOUNTS, and that is the whole bug. `.leaf` plays
 * `leaf-turn` on every division change -- `perspective(1600px) rotateY(-5deg)` settling to
 * `none`, about `transform-origin: left center`. A `getBoundingClientRect()` taken during it
 * is read through that rotation, so every plate's connector reports a position that is wrong
 * by an amount PROPORTIONAL TO ITS DISTANCE FROM THE SPINE. That is why the row did not shift
 * uniformly but fanned: measured mid-turn, the connectors drifted 48.8, 49.9, 50.9, 51.9,
 * 53.0, 54.1 across six plates, and the rightmost even measured its x behind its neighbour's.
 * The drawing was correct; the numbers it was drawn from were taken through a rotating sheet.
 *
 * Two smaller things move the box too. The three faces are self-hosted and subset, and only
 * the latin ranges are preloaded (see `index.html`), so a Vietnamese datum -- "138 bản ghi ·
 * 52 bị từ chối", which is most of them -- is laid out in the fallback face first and re-laid
 * when its subset arrives. And a dev-server stylesheet swap re-styles a plate without ever
 * remounting its node.
 *
 * So: measure once at mount, again when every animation on the leaf has finished, and again
 * when the faces land. Each pass is one measurement of a handful of nodes.
 */
function RemeasurePlates({
  ids,
  canvas,
}: {
  ids: readonly string[];
  canvas: React.RefObject<HTMLDivElement | null>;
}): null {
  const updateNodeInternals = useUpdateNodeInternals();
  // The ids themselves, not the array's identity: `toNodes` builds a new array every render
  // and an effect keyed on it would re-measure forever.
  const key = ids.join(" ");

  useEffect(() => {
    function remeasure(): void {
      for (const id of key.split(" ")) {
        if (id !== "") {
          updateNodeInternals(id);
        }
      }
    }
    remeasure();

    // The turning sheet this sits on. `getAnimations` walks the leaf's own running
    // animations; `leaf-turn` is finite (`both`, 190ms), so awaiting it always settles.
    const leaf = canvas.current?.closest(".leaf");
    const turning = leaf?.getAnimations?.() ?? [];
    void Promise.allSettled(turning.map((animation) => animation.finished)).then(remeasure);

    // Absent in the test DOM, where a missing one only means nothing measures a third time.
    void document.fonts?.ready.then(remeasure);
  }, [key, canvas, updateNodeInternals]);

  return null;
}

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
  const nodeIds = useMemo(() => nodes.map((node) => node.id), [nodes]);
  // A DOM ref, not application state: `RemeasurePlates` needs the leaf this drawing sits
  // on to know when it has stopped turning. `.claude/rules/state.md` allows exactly this.
  const canvasRef = useRef<HTMLDivElement>(null);

  return (
    <div className="run-map stack stack--tight">
      <span className="label">{t("journal.flow.head")}</span>

      <ChainSlip stage={stages.find((stage) => stage.kind === "link-parent")} into="from" />

      <div className="run-map__canvas" aria-hidden="true" ref={canvasRef}>
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            defaultViewport={DRAWING_ORIGIN}
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
          <RemeasurePlates ids={nodeIds} canvas={canvasRef} />
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

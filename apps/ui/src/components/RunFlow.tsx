/**
 * The run's own shape, drawn rather than only narrated: one plate per stage, left to right
 * in the order they happen, a hairline between each.
 *
 * The canvas is `aria-hidden`: everything it shows is already said in words somewhere on
 * this leaf -- `RunEvents` beside it narrates the same feed as sentences, and the two chain
 * links below name and link to the run on the other side of them in real, focusable text.
 * A node here is never the only carrier of a fact, so hiding the canvas from assistive tech
 * loses nothing and avoids the much harder problem of making a live node graph keyboard- and
 * screen-reader-navigable well.
 *
 * `@xyflow/react` supplies the canvas; nothing about its own look survives into this system.
 * No background grid, no minimap, no zoom or pan (this is a schedule, not an infinite
 * canvas), no default node chrome -- the plate is `.run-flow__plate`, the same die-cut
 * language as everywhere else, and the connection points are the punched hole the rest of
 * the system already uses for a hinge and a selection.
 */

import type { Edge, Node, NodeProps, NodeTypes } from "@xyflow/react";
import { Handle, Position, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import type { RunDetail, RunEventView } from "@/api/types.ts";
import { StatusMark } from "@/components/StatusMark.tsx";
import { divisionPath } from "@/lib/divisions.ts";
import { deriveRunFlow, type RunStage } from "@/lib/runFlow.ts";
import type { Locale } from "@undercroft/core/locale";

const NODE_WIDTH = 204;
const NODE_HEIGHT = 74;
const NODE_GAP = 36;
// Matches `.run-flow__canvas`'s own height in index.css: it centers the one row of nodes
// this leaf ever draws, and the two have no way to share a single number across CSS and JS.
const CANVAS_HEIGHT = 122;

type StageNode = Node<RunStage, "stage">;

function StagePlate({ data }: NodeProps<StageNode>): React.JSX.Element {
  const linkClass =
    data.kind === "link-parent" || data.kind === "link-child" ? " run-flow__plate--link" : "";
  return (
    <div className={`run-flow__plate run-flow__plate--${data.mark}${linkClass}`}>
      <Handle type="target" position={Position.Left} />
      <span className="run-flow__label">{data.label}</span>
      <span className="run-flow__foot">
        <StatusMark mark={data.mark} label={data.markLabel} />
        {data.detail === null ? null : (
          <span className="run-flow__detail datum datum--quiet">{data.detail}</span>
        )}
      </span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const NODE_TYPES: NodeTypes = { stage: StagePlate };

function toNodes(stages: readonly RunStage[]): StageNode[] {
  return stages.map((stage, index) => ({
    id: stage.key,
    type: "stage",
    position: { x: index * (NODE_WIDTH + NODE_GAP), y: 0 },
    data: stage,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    draggable: false,
    selectable: false,
    focusable: false,
  }));
}

function toEdges(stages: readonly RunStage[]): Edge[] {
  const edges: Edge[] = [];
  for (let i = 1; i < stages.length; i += 1) {
    const from = stages[i - 1];
    const to = stages[i];
    if (from !== undefined && to !== undefined) {
      const active = to.mark === "pending" ? " run-flow__edge--active" : "";
      edges.push({
        id: `${from.key}->${to.key}`,
        source: from.key,
        target: to.key,
        type: "straight",
        className: `run-flow__edge${active}`,
        focusable: false,
        selectable: false,
        reconnectable: false,
      });
    }
  }
  return edges;
}

/** One chain link, worded and linked in real text -- the accessible half of the pair. */
function ChainLine({ stage }: { stage: RunStage | undefined }): React.JSX.Element | null {
  if (stage === undefined || stage.href === null) {
    return null;
  }
  return (
    <p className="note run-flow__chain">
      <Link to={stage.href}>{stage.label}</Link>
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

  const nodes = useMemo(() => toNodes(stages), [stages]);
  const edges = useMemo(() => toEdges(stages), [stages]);
  const width = stages.length * (NODE_WIDTH + NODE_GAP);

  const parentLink = stages.find((stage) => stage.kind === "link-parent");
  const childLink = stages.find((stage) => stage.kind === "link-child");

  return (
    <div className="stack stack--tight">
      <span className="label">{t("journal.flow.head")}</span>
      <ChainLine stage={parentLink} />
      <div className="run-flow__canvas" aria-hidden="true">
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            defaultViewport={{ x: 20, y: CANVAS_HEIGHT / 2 - NODE_HEIGHT / 2, zoom: 1 }}
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
            proOptions={{ hideAttribution: false }}
            style={{ width: Math.max(width, 1) }}
          />
        </ReactFlowProvider>
      </div>
      <ChainLine stage={childLink} />
    </div>
  );
}

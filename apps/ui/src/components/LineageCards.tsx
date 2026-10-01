/**
 * What the lineage board draws for each thing on it: a card per node, a heading per column, a
 * wire per declared edge. `LineageCanvas` places them; these only render, reading the selection
 * from `useBoard` (`lib/lineageBoard.ts` says why it arrives that way).
 *
 * A CARD IS READ LIKE A TABLE IN A SCHEMA DIAGRAM: what it is and where it stands against the
 * selection, its name, then the one fact a reader tracing a failure wants next -- the last
 * build, or why its upstream cannot be read, or that it is gone. Every one of those is also
 * worded in the card's accessible name, so the dimming and the strokes carry nothing alone.
 *
 * A WIRE ON THE SELECTION'S CHAINS FLOWS (ADR 0100): beads of ink travel along it from source to
 * target, so the upstream chain runs into the selected card and the downstream chain runs out of
 * it. The beads ride on a second path over the wire, which keeps its own stroke -- solid
 * upstream, dotted downstream -- so the legend still reads with the motion stilled.
 */

import type { Edge, EdgeProps, Node, NodeProps } from "@xyflow/react";
import { BaseEdge, getBezierPath, Handle, Position } from "@xyflow/react";
import { useTranslation } from "react-i18next";

import type { LineageNode, ModelItem } from "@/api/types.ts";
import { StatusMark } from "@/components/StatusMark.tsx";
import { edgeState, kindWord, nodeState, nodeWords, stateWord } from "@/lib/lineage.ts";
import { useBoard } from "@/lib/lineageBoard.ts";
import { buildMark, buildMarkLabel } from "@/lib/modelBuild.ts";

interface CardData {
  readonly node: LineageNode;
  // `@xyflow/react`'s Node<T> requires its data to be indexable; the field above is still
  // exactly typed, this only admits the shape to that constraint.
  readonly [key: string]: unknown;
}

interface HeadData {
  readonly label: string;
  readonly [key: string]: unknown;
}

export type CardNode = Node<CardData, "card">;
export type HeadNode = Node<HeadData, "head">;
export type WireEdge = Edge<{ readonly missing: boolean }, "wire">;

/** The card's last line: the build, or the words that stand in for one. */
function Foot({
  node,
  item,
}: {
  node: LineageNode;
  item: ModelItem | undefined;
}): React.JSX.Element {
  const { t } = useTranslation();
  if (node.kind === "raw") {
    return <span className="lineage-card__note">{t("lineage.declaredSource")}</span>;
  }
  if (node.kind === "missing") {
    return (
      <span className="lineage-card__note lineage-card__note--errata">
        {t("lineage.missingShort")}
      </span>
    );
  }
  const status = item?.lastBuild?.status ?? null;
  return (
    <>
      {item === undefined ? null : (
        <StatusMark label={buildMarkLabel(t, status)} mark={buildMark(status)} />
      )}
      {node.undeclared.length > 0 ? (
        <span className="lineage-card__note">{t("lineage.undeclaredMark")}</span>
      ) : null}
    </>
  );
}

export function Card({ data }: NodeProps<CardNode>): React.JSX.Element {
  const { t } = useTranslation();
  const board = useBoard();
  const { node } = data;
  const state = nodeState(board.focus, node.id);
  const where = stateWord(t, state);
  const item = node.kind === "model" ? board.builds.get(node.name) : undefined;
  const label = [
    node.name,
    ...nodeWords(t, node, state),
    ...(item === undefined ? [] : [buildMarkLabel(t, item.lastBuild?.status ?? null)]),
  ].join(" · ");
  const classes = ["lineage-card", `lineage-card--${node.kind}`, `lineage-card--${state}`];
  if (node.kind === "model" && node.undeclared.length > 0) {
    classes.push("lineage-card--undeclared");
  }

  return (
    <div className={classes.join(" ")}>
      <Handle
        className="lineage-card__port"
        isConnectable={false}
        position={Position.Left}
        type="target"
      />
      <button
        aria-label={label}
        aria-pressed={state === "selected"}
        className="lineage-card__face"
        onClick={(): void => {
          board.select(state === "selected" ? null : node.name);
        }}
        title={node.name}
        type="button"
      >
        <span className="lineage-card__head">
          <span className="lineage-card__kind">{kindWord(t, node)}</span>
          {where === null ? null : <span className="lineage-card__where">{where}</span>}
        </span>
        <span className="lineage-card__name">{node.name}</span>
        <span className="lineage-card__foot">
          <Foot item={item} node={node} />
        </span>
      </button>
      <Handle
        className="lineage-card__port"
        isConnectable={false}
        position={Position.Right}
        type="source"
      />
    </div>
  );
}

export function Head({ data }: NodeProps<HeadNode>): React.JSX.Element {
  return <span className="lineage-head">{data.label}</span>;
}

export function Wire({
  source,
  target,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps<WireEdge>): React.JSX.Element {
  const { focus } = useBoard();
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const state = edgeState(focus, source, target);
  const classes = ["lineage-wire", `lineage-wire--${state}`];
  if (data?.missing === true) {
    classes.push("lineage-wire--missing");
  }
  return (
    <>
      <BaseEdge
        className={classes.join(" ")}
        interactionWidth={0}
        path={path}
        {...(markerEnd === undefined ? {} : { markerEnd })}
      />
      {state === "chain" || state === "downstream" ? (
        <path className="lineage-wire__flow" d={path} />
      ) : null}
    </>
  );
}

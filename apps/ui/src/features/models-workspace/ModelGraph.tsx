import "./workspace.css";
import "./details.css";
import {
  Background,
  Controls,
  Handle,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
} from "@xyflow/react";
import { useEffect, useRef } from "react";
import { patchWorkspace, useWords, useWorkspace } from "./hooks.ts";
import { layout } from "./layout.ts";
import { GroupLabel } from "./shared.tsx";
import type { Catalog } from "./types.ts";

function ModelNode({ data }: NodeProps): React.JSX.Element {
  const { t } = useWords();
  return (
    <div className="mw-node" data-root={Boolean(data.root)}>
      <Handle type="target" position={Position.Left} />
      <span className="mw-eyebrow">
        <GroupLabel id={String(data.layer)} />
        {data.root ? ` · ${t("modelsWorkspace.center")}` : ""}
      </span>
      <button
        type="button"
        className="mw-name"
        onClick={(): void => patchWorkspace({ quickModel: String(data.id) })}
      >
        <strong>{String(data.title)}</strong>
        <code>{String(data.id)}</code>
      </button>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { model: ModelNode };
export function ModelGraph({
  catalog,
  ids,
  root,
}: {
  catalog: Catalog;
  ids: string[];
  root: string;
}): React.JSX.Element {
  const { t, locale } = useWords();
  const state = useWorkspace();
  useGraphLayout(catalog, ids);
  const key = JSON.stringify([catalog.revision, ids]);
  const cameraKey = `${catalog.revision}:${root}`;
  const savedViewport = state.viewport?.key === cameraKey ? state.viewport : undefined;
  if (state.layoutStatus === "error") {
    return <GraphError />;
  }
  if (!state.layout || state.layoutKey !== key) {
    return (
      <p className="mw-empty" role="status">
        {t("modelsWorkspace.loading")}
      </p>
    );
  }
  const nodes = state.layout.nodes.map((position) => {
    const model = catalog.models.find((item) => item.id === position.id);
    return {
      id: position.id,
      type: "model",
      position: { x: position.x, y: position.y },
      data: {
        id: position.id,
        title: model?.title[locale] ?? position.id,
        layer: model?.layer ?? "raw",
        root: position.id === root,
      },
    };
  });
  const edges = catalog.edges
    .filter((edge) => ids.includes(edge.source) && ids.includes(edge.target))
    .map((edge) => ({
      id: `${edge.source}:${edge.target}`,
      source: edge.source,
      target: edge.target,
      markerEnd: { type: "arrowclosed" as const },
    }));
  return (
    <div className="mw-canvas">
      <ReactFlowProvider key={root}>
        <ReactFlow
          ariaLabelConfig={{
            "controls.zoomIn.ariaLabel": t("modelsWorkspace.zoomIn"),
            "controls.zoomOut.ariaLabel": t("modelsWorkspace.zoomOut"),
            "controls.fitView.ariaLabel": t("modelsWorkspace.fitView"),
          }}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          defaultViewport={savedViewport ?? { x: 0, y: 0, zoom: 1 }}
          onMoveEnd={(_event, viewport): void =>
            patchWorkspace({ viewport: { key: cameraKey, ...viewport } })
          }
          fitView={!savedViewport}
          minZoom={0.25}
          maxZoom={1.5}
        >
          <Background />
          <Controls showInteractive={false} />
          <InitialFit enabled={!savedViewport} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}

function InitialFit({ enabled }: { enabled: boolean }): null {
  const initialized = useNodesInitialized();
  const { fitView } = useReactFlow();
  const fittedRef = useRef(false);
  useEffect(() => {
    if (enabled && initialized && !fittedRef.current) {
      fittedRef.current = true;
      void fitView({ padding: 0.12, maxZoom: 1 });
    }
  }, [initialized, fitView, enabled]);
  return null;
}

function useGraphLayout(catalog: Catalog, ids: string[]): void {
  const { layoutAttempt } = useWorkspace();
  const signature = JSON.stringify([ids, layoutAttempt]);
  useEffect(() => {
    const controller = new AbortController();
    patchWorkspace({ layoutStatus: "working", layoutError: null });
    const [selected]: [string[], number] = JSON.parse(signature);
    const edges = catalog.edges.filter(
      (edge) => selected.includes(edge.source) && selected.includes(edge.target),
    );
    const roles = ["raw", "input", "transform", "output", "unclassified"];
    const partitions = Object.fromEntries(
      selected.map((id) => [
        id,
        roles.indexOf(catalog.models.find((model) => model.id === id)?.layer ?? "raw"),
      ]),
    );
    void layout(selected, edges, controller.signal, partitions)
      .then((result) => {
        if (!controller.signal.aborted) {
          patchWorkspace({
            layout: result,
            layoutStatus: "ready",
            layoutKey: JSON.stringify([catalog.revision, selected]),
          });
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          patchWorkspace({
            layout: null,
            layoutStatus: "error",
            layoutError: error instanceof Error ? error.message : "Layout failed",
          });
        }
      });
    return (): void => controller.abort();
  }, [signature, catalog]);
}

function GraphError(): React.JSX.Element {
  const { t } = useWords();
  const state = useWorkspace();
  return (
    <div className="mw-empty" role="status" data-layout-error={state.layoutError}>
      <p>{t("modelsWorkspace.layoutError")}</p>
      <button
        type="button"
        className="plate"
        onClick={(): void => patchWorkspace({ layoutAttempt: state.layoutAttempt + 1 })}
      >
        {t("modelsWorkspace.retry")}
      </button>
    </div>
  );
}

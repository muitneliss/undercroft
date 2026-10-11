import ELK, { type ElkNode } from "elkjs/lib/elk-api.js";
import ElkWorker from "elkjs/lib/elk-worker.min.js?worker";
import type { Dependency, LayoutResult } from "./types.ts";

const cache = new Map<string, LayoutResult>();
/** A cancelled request terminates its worker; ignoring a promise alone would leave ELK running. */
export function layout(
  ids: string[],
  edges: Dependency[],
  signal: AbortSignal,
  partitions: Record<string, number>,
): Promise<LayoutResult> {
  const key = JSON.stringify([ids, edges, partitions]);
  const cached = cache.get(key);
  if (cached) {
    return Promise.resolve(cached);
  }
  return new Promise((resolve, reject) => {
    const worker = new ElkWorker();
    const elk = new ELK({ workerFactory: (): Worker => worker });
    function finish(): void {
      clearTimeout(timer);
      worker.terminate();
      signal.removeEventListener("abort", abort);
    }
    function abort(): void {
      finish();
      reject(new DOMException("Aborted", "AbortError"));
    }
    const timer = setTimeout(() => {
      finish();
      reject(new Error("Layout timed out"));
    }, 3000);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    worker.onerror = (): void => {
      finish();
      reject(new Error("Layout worker failed"));
    };
    void elk
      .layout(layoutGraph(ids, edges, partitions))
      .then((graph) => {
        finish();
        const result: LayoutResult = {
          nodes: (graph.children ?? []).map((node) => ({
            id: node.id,
            x: node.x ?? 0,
            y: node.y ?? 0,
          })),
          width: graph.width ?? 0,
          height: graph.height ?? 0,
        };
        if (cache.size >= 8) {
          const first = cache.keys().next().value;
          if (first !== undefined) {
            cache.delete(first);
          }
        }
        cache.set(key, result);
        resolve(result);
      })
      .catch((error: unknown) => {
        finish();
        reject(error);
      });
  });
}

function layoutGraph(
  ids: string[],
  edges: Dependency[],
  partitions: Record<string, number>,
): ElkNode {
  return {
    id: "models",
    width: 0,
    height: 0,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.partitioning.activate": "true",
      "elk.spacing.nodeNode": "36",
      "elk.layered.spacing.nodeNodeBetweenLayers": "72",
    },
    children: ids.map((id) => ({
      id,
      width: 240,
      height: 140,
      layoutOptions: { "elk.partitioning.partition": String(partitions[id] ?? 4) },
    })),
    edges: edges.map((edge, index) => ({
      id: String(index),
      sources: [edge.source],
      targets: [edge.target],
    })),
  };
}

/**
 * A node-and-edge drawing as a village (ADR 0115): a run's map, or the models' lineage. Every
 * node is a building, every edge a road, every flowing edge carries traffic (`lib/village/graph.ts`).
 *
 * Loaded on its own (`React.lazy` at each caller), so `three` and the models come with the first
 * drawing a reader opens and with nothing else.
 *
 * The canvas is `aria-hidden` and draws no letter: every name, count and link the drawing stands
 * for is in words beside it, as it was beside the boards this replaces. `words` is the element
 * they are in; pointing at a building lights whichever of them is marked `data-node` with its id.
 * Nothing here is `useState`: the film holds its own values (`lib/village/film.ts`).
 */

import { type RefObject, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Vector3 } from "three";

import { Film } from "@/lib/village/film.ts";
import type { VillageGraph as Graph } from "@/lib/village/graph.ts";
import { GraphWorld } from "@/lib/village/graphWorld.ts";

/** The board seen from the south, raised and turned a little from the east; fitted to its roofs. */
const VIEW = { camera: new Vector3(4, 18, 14), fitHeight: 1.6 } as const;

export function VillageGraph({
  graph,
  words,
  onNode,
  onGround,
  className,
}: {
  graph: Graph;
  /** The element whose `data-node` marks answer the pointer; the frame's own parent if absent. */
  words?: RefObject<HTMLElement | null>;
  /** A building was pressed: its node's id. */
  onNode?: (id: string) => void;
  /** The ground was pressed, away from every building. */
  onGround?: () => void;
  /** Sizes the frame: `village--strip` for a run's map. */
  className?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const filmRef = useRef<Film<Graph> | null>(null);
  const latestRef = useRef(graph);
  // The latest press handlers, read when a press happens rather than captured when the film
  // starts, so a caller's new closure never restarts the film.
  const handlersRef = useRef({ onNode, onGround });
  useEffect(() => {
    handlersRef.current = { onNode, onGround };
  }, [onNode, onGround]);

  useEffect(() => {
    let alive = true;
    const frame = frameRef.current;
    const canvas = canvasRef.current;
    const answering = words?.current ?? frame?.parentElement ?? null;
    if (frame === null || canvas === null || answering === null) {
      return;
    }
    void Film.start<Graph>(
      { frame, canvas, words: answering },
      (kit) => new GraphWorld(kit),
      (kind, id) => {
        if (kind === "node") {
          handlersRef.current.onNode?.(id);
        } else if (kind === "ground") {
          handlersRef.current.onGround?.();
        }
      },
      VIEW,
    ).then((started) => {
      if (!alive) {
        started?.dispose();
        return;
      }
      filmRef.current = started;
      started?.show(latestRef.current);
    });
    return (): void => {
      alive = false;
      filmRef.current?.dispose();
      filmRef.current = null;
    };
  }, [words]);

  useEffect(() => {
    latestRef.current = graph;
    filmRef.current?.show(graph);
  }, [graph]);

  return (
    <div
      className={["village", className].filter(Boolean).join(" ")}
      ref={frameRef}
      aria-busy="true"
    >
      <div className="village__picture" aria-hidden="true">
        <canvas ref={canvasRef} />
      </div>
      <p className="prose village__failed">{t("common.drawingFailed")}</p>
    </div>
  );
}

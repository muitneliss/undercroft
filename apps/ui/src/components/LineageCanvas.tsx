/**
 * The lineage drawn as a village (ADR 0116): a building per node where ELK placed its card, a
 * road per declared edge along the line ELK routed, the selected node's upstream chain inked and
 * its downstream chain dashed, carts rolling along both, and everything else faded
 * (`lib/village/graph.ts`, `lineageGraph`). It replaces the pannable board of ADR 0097: the camera
 * is fixed and fits the whole lineage, however large.
 *
 * WHY ELK STILL PLACES IT. The columns stand for how far a model is from the raw lake
 * (`layout`), and ELK keeps a wire that spans columns between the cards it does not join, not
 * over them (`arrange`, ADR 0103). The village keeps both: its streets are those routes.
 *
 * PRESSING. A building selects its node, as its card did; the bare board clears the selection, as
 * the board's pane did. The selection is the address, as before (`ModelLineage`).
 *
 * THE KEYBOARD AND THE WORDS. The canvas is `aria-hidden`. The picker above it, the details
 * beside it and the text beneath it reach every node and name every chain in words, and each
 * name of a node is marked with its id (`NodeLink`), so pointing at a building lights them.
 *
 * It draws only what `models.lineage` returned; there is nothing here that could add an edge.
 */

import { lazy, type RefObject, Suspense, useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { ModelItem, ModelLineage as Graph } from "@/api/types.ts";
import { Skeleton } from "@/components/Skeleton.tsx";
import { useFullscreen } from "@/lib/fullscreen.ts";
import type { Focus } from "@/lib/lineage.ts";
import { type Arrangement, useArrangement } from "@/lib/lineageArrange.ts";
import { lineageGraph } from "@/lib/village/graph.ts";

const VillageGraph = lazy(() =>
  import("@/components/VillageGraph.tsx").then((module) => ({ default: module.VillageGraph })),
);

interface BoardProps {
  graph: Graph;
  /** The part of `graph` drawn: all of it, or the selection's chains. */
  drawn: Graph;
  focus: Focus;
  builds: ReadonlyMap<string, ModelItem>;
  select: (name: string | null) => void;
  /** The drawing and its details together: what full screen fills. */
  bench: RefObject<HTMLElement | null>;
  /** The whole lineage view: where the words that name each node are. */
  words: RefObject<HTMLElement | null>;
}

/** The village, once ELK has arranged it; its place is held while ELK works. */
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
  drawn,
  focus,
  builds,
  select,
  bench,
  words,
  arrangement,
}: BoardProps & { arrangement: Arrangement }): React.JSX.Element {
  const { t } = useTranslation();
  const screen = useFullscreen(bench);
  const village = useMemo(
    () => lineageGraph(drawn, focus, arrangement, builds),
    [drawn, focus, arrangement, builds],
  );
  const names = useMemo(() => new Map(drawn.nodes.map((node) => [node.id, node.name])), [drawn]);

  return (
    <>
      {screen.available ? (
        <div className="row">
          {/* The label says what a press does, so there is no `aria-pressed` as well: with both,
              a screen reader hears "Exit full screen, pressed" -- the state twice. */}
          <button className="plate plate--small" onClick={screen.toggle} type="button">
            {screen.on ? t("lineage.exitFullscreen") : t("lineage.fullscreen")}
          </button>
        </div>
      ) : null}
      <Suspense fallback={<Skeleton rows={6} />}>
        <VillageGraph
          graph={village}
          words={words}
          onNode={(id): void => {
            select(names.get(id) ?? null);
          }}
          onGround={(): void => {
            select(null);
          }}
        />
      </Suspense>
    </>
  );
}

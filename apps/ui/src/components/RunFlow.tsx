/**
 * The run's own shape, drawn as a village (ADR 0116): a building per stage, left to right in the
 * order they happen, a road between each and the next, and a courier carrying the work along the
 * road out of a stage still working (`lib/village/graph.ts`, `runMapGraph`).
 *
 * WHAT EACH BUILDING IS. An entity read is a market stall of the Sources division, the run's own
 * verdict the town hall, a build the workshop, a lake-API landing the vault. A stage that stopped
 * stands under an errata slip, in the vermilion-ruled language a correction wears everywhere else
 * in this interface.
 *
 * THE ROAD IS ALIVE WHILE THE RUN IS. A road out of a finished stage is quiet; a courier walks the
 * road out of a stage still working, which is the one honest live signal the drawing has and the
 * thing that tells an operator mid-call that something is happening without them reading a number.
 *
 * THE CANVAS IS `aria-hidden`, and it draws this run's own stages only. Everything on it is said
 * in words elsewhere on this leaf: `RunEvents` beside it narrates the same feed as sentences,
 * `RunProgress` the gauges, and the counts table below prints the same figures. A chain link is
 * different -- it is the only route to another run -- so it is not drawn at all. It is a
 * continuation slip above or below, in real, focusable text, printed once.
 */

import { lazy, Suspense, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type { Locale } from "@undercroft/core/locale";

import type { RunDetail, RunEventView } from "@/api/types.ts";
import { ArrowLeft, ArrowRight } from "@/components/Icon.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { StatusMark } from "@/components/StatusMark.tsx";
import { divisionPath } from "@/lib/divisions.ts";
import { deriveRunFlow, type RunStage } from "@/lib/runFlow.ts";
import { runMapGraph } from "@/lib/village/graph.ts";

const VillageGraph = lazy(() =>
  import("@/components/VillageGraph.tsx").then((module) => ({ default: module.VillageGraph })),
);

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
  // The drawing is the run's own stages; a chain link is a slip beside it, not a building on it
  // -- it belongs to the run on the other side of it.
  const graph = useMemo(() => runMapGraph(stages), [stages]);

  return (
    <div className="stack stack--tight">
      <span className="label">{t("journal.flow.head")}</span>

      <ChainSlip stage={stages.find((stage) => stage.kind === "link-parent")} into="from" />

      <Suspense fallback={<Skeleton rows={2} />}>
        <VillageGraph graph={graph} className="village--strip" />
      </Suspense>

      <ChainSlip stage={stages.find((stage) => stage.kind === "link-child")} into="onto" />
    </div>
  );
}

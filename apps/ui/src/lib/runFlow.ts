/**
 * A run's own shape, as a line of stages rather than a table of sentences.
 *
 * `RunEvents` beside this already says everything the worker narrated, in order, as prose;
 * this answers a different question -- not "what happened" but "where are we", at a glance,
 * which a scrolling table of sentences cannot. It is derived from the same two sources the
 * rest of the leaf already reads and adds no query of its own: `events` while a run is live,
 * and `entityCounts` / `steps` as the authoritative, never-truncated closed record once it
 * has settled. The per-entity half of that -- the one run kind with a real breakdown to
 * build -- lives in `runFlowEntities.ts`; this module is the other stage kinds plus the
 * assembly that puts a run's whole line of stages in order.
 *
 * One stage per entity, never a placeholder for one still to come: the browser has no
 * independent knowledge of a connector spec's entity list, so inventing an "upcoming" node
 * for an entity nobody has mentioned yet would be exactly the guess rule 2 refuses. A stage
 * exists once there is evidence for it and not before.
 */

// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses.
// biome-ignore-all lint/style/useExportsLast: Reordering modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. That ordering carries meaning; the rule's preferred one does not.

import type { Locale } from "@undercroft/core/locale";
import type { TFunction } from "i18next";

import type { RunDetail, RunEventView } from "@/api/types.ts";
import { entityAccumulators, entityStages, landedSummary } from "@/lib/runFlowEntities.ts";
import { markForStatus, type RunStage } from "@/lib/runFlowTypes.ts";
import { runMarkLabel, sourceLabel } from "@/lib/runs.ts";

export type { RunStage, StageKind, StageMark } from "@/lib/runFlowTypes.ts";

type RunLinkView = NonNullable<RunDetail["parentRun"]>;

/**
 * The run's own outcome, distinct from any one entity's: `settle()` closes the ledger after
 * every entity has already had its own say, and can itself fail with every entity granted.
 * Only an ingest run gets this stage separately -- a transform, a build or a lake-api run
 * has exactly one stage in the first place, which already carries the run's own status.
 */
function outcomeStage(t: TFunction, locale: Locale, run: RunDetail): RunStage {
  const mark = markForStatus(run.status);
  return {
    key: "outcome",
    kind: "outcome",
    label: runMarkLabel(t, run.status),
    mark,
    markLabel: runMarkLabel(t, run.status),
    detail:
      run.counts === null ? null : landedSummary(t, locale, run.counts.landed, run.counts.refused),
    href: null,
  };
}

/** The one stage of a transform/build run: there is no per-model live signal, only an outcome. */
function modelsStage(t: TFunction, run: RunDetail): RunStage {
  const mark = markForStatus(run.status);
  let detail: string | null = null;
  if (run.status !== "running") {
    const models = run.steps.filter((step) => step.kind === "model").length;
    const tests = run.steps.filter((step) => step.kind === "test").length;
    if (run.steps.length === 0) {
      detail = t("journal.flow.modelsNone");
    } else if (run.testsFailed !== null && run.testsFailed > 0) {
      detail = t("journal.flow.modelsSummaryFailed", {
        models,
        tests,
        testsFailed: run.testsFailed,
      });
    } else {
      detail = t("journal.flow.modelsSummary", { models, tests });
    }
  }
  return {
    key: "models",
    kind: "models",
    label: t("journal.flow.models"),
    mark,
    markLabel: runMarkLabel(t, run.status),
    detail,
    href: null,
  };
}

/** The one stage of a run an external caller landed straight through the lake API. */
function lakeStage(t: TFunction, locale: Locale, run: RunDetail): RunStage {
  const mark = markForStatus(run.status);
  return {
    key: "lake",
    kind: "lake",
    label: t("journal.kindLakeApi", { source: sourceLabel(run.source ?? "") }),
    mark,
    markLabel: runMarkLabel(t, run.status),
    detail:
      run.counts === null ? null : landedSummary(t, locale, run.counts.landed, run.counts.refused),
    href: null,
  };
}

function linkStage(
  t: TFunction,
  kind: "link-parent" | "link-child",
  link: RunLinkView,
  href: string,
): RunStage {
  const label =
    kind === "link-parent"
      ? t("journal.flow.chainedFrom", { source: sourceLabel(link.source ?? "") })
      : t("journal.flow.chainedTo");
  return {
    key: kind,
    kind,
    label,
    mark: markForStatus(link.status),
    markLabel: runMarkLabel(t, link.status),
    detail: null,
    href,
  };
}

export interface RunFlowInput {
  readonly run: RunDetail;
  readonly events: readonly RunEventView[];
  /** Where a chain link goes: the leaf's own route for a run by id. */
  readonly runHref: (runId: string) => string;
}

/**
 * The run's stages, left to right in the order they happen: the ingest it chained from (if
 * any), its own stages, and the build it chained into (if any) -- {@link RunStage.href} is
 * how a leaf on one side of a chain reaches the leaf on the other side of it.
 */
export function deriveRunFlow(
  t: TFunction,
  locale: Locale,
  input: RunFlowInput,
): readonly RunStage[] {
  const { run, events, runHref } = input;
  const stages: RunStage[] = [];
  if (run.parentRun !== null) {
    stages.push(linkStage(t, "link-parent", run.parentRun, runHref(run.parentRun.id)));
  }

  if (run.kind === "ingest") {
    const accs = entityAccumulators(run, events);
    stages.push(...entityStages(t, locale, run, accs));
    stages.push(outcomeStage(t, locale, run));
  } else if (run.kind === "lake-api") {
    stages.push(lakeStage(t, locale, run));
  } else {
    stages.push(modelsStage(t, run));
  }

  if (run.childRun !== null) {
    stages.push(linkStage(t, "link-child", run.childRun, runHref(run.childRun.id)));
  }
  return stages;
}

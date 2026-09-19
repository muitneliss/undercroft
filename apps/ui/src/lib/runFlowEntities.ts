/**
 * An ingest run's per-entity stages, built from the same two sources `runFlow.ts` reads:
 * `events` while a run is live (entities only get a row in `ops.run_entity` once the WHOLE
 * run settles, so while running that table is empty and the feed is the only evidence there
 * is), and `entityCounts` as the authoritative, never-truncated closed record once it has.
 *
 * Split out of `runFlow.ts` on file length alone -- this is the one run kind with a real
 * per-entity breakdown to build, and the rest of that module's stages (a transform's, a
 * lake-api run's, a chain link's) have no use for any of it.
 */

import type { Locale } from "@undercroft/core/locale";
import type { TFunction } from "i18next";

import type { RunDetail, RunEventView } from "@/api/types.ts";
import { formatCount } from "@/lib/money.ts";
import type { RunStage, StageMark } from "@/lib/runFlowTypes.ts";

interface EntityAcc {
  readonly entity: string;
  started: boolean;
  done: boolean;
  read: number | null;
  total: number | null;
  landed: number | null;
  refused: number | null;
}

function numberField(detail: Readonly<Record<string, unknown>>, key: string): number | null {
  const value = detail[key];
  return typeof value === "number" ? value : null;
}

/** "234", or "234 · 12 refused" once a refusal is worth calling out. MISSING for no count at all. */
export function landedSummary(
  t: TFunction,
  locale: Locale,
  landed: number | null,
  refused: number | null,
): string {
  if (refused !== null && refused > 0) {
    return t("journal.flow.entityLandedRefused", {
      landed: formatCount(landed, locale),
      refused: formatCount(refused, locale),
    });
  }
  return formatCount(landed, locale);
}

/** What one event says about the entity it concerns -- the caller has already resolved which. */
function applyEntityEvent(acc: EntityAcc, event: RunEventView): void {
  if (event.event === "entity_started") {
    acc.started = true;
  } else if (event.event === "work_listed") {
    acc.total = numberField(event.detail, "total") ?? acc.total;
  } else if (event.event === "records_read") {
    acc.read = numberField(event.detail, "read") ?? acc.read;
    acc.total = numberField(event.detail, "total") ?? acc.total;
  } else if (event.event === "entity_done") {
    acc.started = true;
    acc.done = true;
    acc.landed = numberField(event.detail, "landed");
    acc.refused = numberField(event.detail, "refused");
  }
}

/**
 * Every entity the run has said anything about, in the order first mentioned.
 *
 * Read order comes from the feed alone: `entityCounts` is authoritative for the final
 * numbers but is stored keyed `(run_id, entity)` and read back alphabetically, which is not
 * the order the worker read them in. Once closed, any entity `entityCounts` names that a
 * capped or pre-journal feed never mentioned is appended after every entity the feed did
 * narrate, rather than dropped -- the closed ledger is never allowed to say less than the
 * live one did.
 */
export function entityAccumulators(run: RunDetail, events: readonly RunEventView[]): EntityAcc[] {
  const accs: EntityAcc[] = [];
  const byEntity = new Map<string, EntityAcc>();

  function touch(entity: string): EntityAcc {
    const existing = byEntity.get(entity);
    if (existing !== undefined) {
      return existing;
    }
    const created: EntityAcc = {
      entity,
      started: false,
      done: false,
      read: null,
      total: null,
      landed: null,
      refused: null,
    };
    byEntity.set(entity, created);
    accs.push(created);
    return created;
  }

  for (const event of events) {
    if (event.entity !== null) {
      applyEntityEvent(touch(event.entity), event);
    }
  }

  if (run.status !== "running") {
    for (const row of run.entityCounts) {
      const acc = touch(row.entity);
      acc.started = true;
      acc.done = true;
      acc.landed = row.landed;
      acc.refused = row.refused;
    }
  }

  return accs;
}

/** The one entity mid-flight when a run failed. Never more than one: entities run one at a time. */
function interruptedEntity(run: RunDetail, accs: readonly EntityAcc[]): string | null {
  if (run.status !== "failed") {
    return null;
  }
  return accs.find((acc) => acc.started && !acc.done)?.entity ?? null;
}

function entityDetail(t: TFunction, locale: Locale, acc: EntityAcc): string | null {
  if (acc.done) {
    return landedSummary(t, locale, acc.landed, acc.refused);
  }
  if (acc.read === null) {
    return null;
  }
  return acc.total === null
    ? formatCount(acc.read, locale)
    : `${formatCount(acc.read, locale)} / ${formatCount(acc.total, locale)}`;
}

function entityMarkLabel(t: TFunction, mark: StageMark): string {
  if (mark === "lapsed") {
    return t("journal.flow.entityInterrupted");
  }
  if (mark === "granted") {
    return t("journal.flow.entityDone");
  }
  return t("journal.flow.entityActive");
}

function entityStageMark(acc: EntityAcc, interrupted: boolean): StageMark {
  if (interrupted) {
    return "lapsed";
  }
  return acc.done ? "granted" : "pending";
}

export function entityStages(
  t: TFunction,
  locale: Locale,
  run: RunDetail,
  accs: readonly EntityAcc[],
): RunStage[] {
  const interrupted = interruptedEntity(run, accs);
  return accs.map((acc) => {
    const mark = entityStageMark(acc, acc.entity === interrupted);
    return {
      key: `entity:${acc.entity}`,
      kind: "entity",
      label: acc.entity,
      mark,
      markLabel: entityMarkLabel(t, mark),
      detail: entityDetail(t, locale, acc),
      href: null,
    };
  });
}

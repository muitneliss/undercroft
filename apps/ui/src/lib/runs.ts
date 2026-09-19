/**
 * What a run looks like from the card, and when the next one is.
 *
 * A run has three outcomes and the card has four marks, and the mapping is the whole point
 * of this module: an `ok` run is a granted mark, a `running` one is pending, a `failed` one
 * is lapsed, and no run at all is absent. The same four geometries the grant itself uses,
 * so a schedule of sources reads the same way at the run column as at the status column --
 * and survives greyscale for the same reason.
 *
 * `nextRunNote` words the server's `nextRunAt`, which is the one schedule rule
 * (`@undercroft/contracts`). A value in the past is not a missed run: the scheduler asks
 * every fifteen minutes, so it means "at the next tick", and the note says that rather than
 * printing a time that already went by.
 */

// biome-ignore-all lint/style/useExportsLast: Reordering modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. That ordering carries meaning; the rule's preferred one does not.

import type { Locale } from "@undercroft/core/locale";
import type { TFunction } from "i18next";

import type { Connection } from "@/api/types.ts";
import type { CardFacts } from "@/lib/connectionState.ts";
import { MISSING } from "@/lib/money.ts";
import { formatDateTime } from "@/lib/when.ts";

export type LastRun = NonNullable<Connection["lastRun"]>;
export type RunStatus = LastRun["status"];

export function runMark(status: RunStatus | null): CardFacts["mark"] {
  switch (status) {
    case "ok":
      return "granted";
    case "running":
      return "pending";
    case "failed":
      return "lapsed";
    case null:
      return "absent";
    default: {
      const exhaustive: never = status;
      throw new Error(`unhandled run status ${String(exhaustive)}`);
    }
  }
}

/** The word beside the mark: the outcome, or that there has never been one. */
export function runMarkLabel(t: TFunction, status: RunStatus | null): string {
  switch (status) {
    case "ok":
      return t("run.ok");
    case "running":
      return t("run.running");
    case "failed":
      return t("run.failed");
    case null:
      return t("run.never");
    default: {
      const exhaustive: never = status;
      throw new Error(`unhandled run status ${String(exhaustive)}`);
    }
  }
}

/**
 * When the source next runs, as the card says it.
 *
 * Paused says so rather than showing a dash that reads as missing data; a source that is
 * waiting for a scope has no next run and the card's own state already explains why, so it
 * gets MISSING; a due time already past means the scheduler's next tick.
 */
export function nextRunNote(
  t: TFunction,
  locale: Locale,
  connection: Pick<Connection, "cadence" | "nextRunAt">,
  now: Date = new Date(),
): string {
  if (connection.cadence === "paused") {
    return t("when.pausedNoNext");
  }
  if (connection.nextRunAt === null) {
    return MISSING;
  }
  const due = new Date(connection.nextRunAt);
  if (Number.isNaN(due.getTime())) {
    return MISSING;
  }
  if (due.getTime() <= now.getTime()) {
    return t("when.dueNow");
  }
  return formatDateTime(connection.nextRunAt, locale);
}

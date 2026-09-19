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

// biome-ignore-all lint/security/noSecrets: False positives on catalogue keys -- `journal.emptyBodyNoSchedule` is a dotted identifier into `@/i18n`, not a credential. No real secret is in any tracked file; CI enforces that separately.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useExportsLast: Reordering modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. That ordering carries meaning; the rule's preferred one does not.

import type { Locale } from "@undercroft/core/locale";
import type { TFunction } from "i18next";

import { type Connection, isSource, type RunView, SOURCE_LABEL } from "@/api/types.ts";
import type { CardFacts } from "@/lib/connectionState.ts";
import { MISSING } from "@/lib/money.ts";
import { formatDateTime } from "@/lib/when.ts";

export type LastRun = NonNullable<Connection["lastRun"]>;
export type RunStatus = LastRun["status"];

/** A vendor's own name where we have one; the source's id where we do not. */
export function sourceLabel(source: string): string {
  return isSource(source) ? SOURCE_LABEL[source] : source;
}

/**
 * What a run did, as one line of the journal: the source and what it read, or that it was
 * a build of the models. Entity names stay as the source calls them -- `deals`, `contacts`
 * -- because they are identifiers a reader will meet again in the raw lake.
 */
export function describeRun(
  t: TFunction,
  run: Pick<RunView, "kind" | "source" | "entities">,
): string {
  const source = run.source === null ? "" : sourceLabel(run.source);
  switch (run.kind) {
    case "ingest":
      return run.entities.length === 0 ? source : `${source} · ${run.entities.join(", ")}`;
    case "lake-api":
      return t("journal.kindLakeApi", { source });
    case "transform":
      return t("journal.kindModels");
    case "build":
      return t("journal.kindBuild");
    default: {
      const exhaustive: never = run.kind;
      throw new Error(`unhandled run kind ${String(exhaustive)}`);
    }
  }
}

/** Who or what started the run, in the quiet face beneath the line. */
export function triggerLabel(t: TFunction, trigger: RunView["trigger"]): string {
  switch (trigger) {
    case "schedule":
      return t("journal.triggerSchedule");
    case "manual":
      return t("journal.triggerManual");
    case "build":
      return t("journal.triggerBuild");
    case "lake-api":
      return t("journal.triggerLakeApi");
    default: {
      const exhaustive: never = trigger;
      throw new Error(`unhandled trigger ${String(exhaustive)}`);
    }
  }
}

/**
 * What an empty journal teaches: when the first run comes, or what stands in its way.
 *
 * The earliest due time across the customer's sources, worded the way the card words a
 * next run. No due time at all means no source is ready, and the sentence says where to
 * go rather than that there is nothing here.
 */
export type FirstRun = { kind: "none" } | { kind: "due-now" } | { kind: "at"; at: string };

/**
 * When the first run comes, wordlessly: nothing is scheduled, it is due at the next tick,
 * or it is at an instant. The journal and the lake each word it in their own sentence;
 * the decision is made once, here.
 */
export function firstRun(
  connections: readonly Pick<Connection, "nextRunAt">[],
  now: Date = new Date(),
): FirstRun {
  const due = connections
    .map((c) => (c.nextRunAt === null ? Number.NaN : new Date(c.nextRunAt).getTime()))
    .filter((ms) => !Number.isNaN(ms));
  if (due.length === 0) {
    return { kind: "none" };
  }
  const earliest = Math.min(...due);
  if (earliest <= now.getTime()) {
    return { kind: "due-now" };
  }
  return { kind: "at", at: new Date(earliest).toISOString() };
}

export function journalEmptyBody(
  t: TFunction,
  locale: Locale,
  connections: readonly Pick<Connection, "nextRunAt">[],
  now: Date = new Date(),
): string {
  const first = firstRun(connections, now);
  switch (first.kind) {
    case "none":
      return t("journal.emptyBodyNoSchedule");
    case "due-now":
      return t("journal.emptyBodyDueNow");
    case "at":
      return t("journal.emptyBody", { when: formatDateTime(first.at, locale) });
    default: {
      const exhaustive: never = first;
      return exhaustive;
    }
  }
}

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

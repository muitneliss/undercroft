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
 * every `SCHEDULER_TICK_MS`, so it means "at the next tick", and the note says that rather than
 * printing a time that already went by.
 */

import { parseSourceInstance } from "@undercroft/contracts/sources";
import type { Locale } from "@undercroft/core/locale";
import type { TFunction } from "i18next";

import {
  type Connection,
  isSource,
  type RunDetail,
  type RunView,
  type Source,
  SOURCE_LABEL,
} from "@/api/types.ts";
import { type CardFacts, scopeSummary } from "@/lib/connectionState.ts";
import { divisionPath } from "@/lib/divisions.ts";
import { MISSING } from "@/lib/money.ts";
import { TICK_MINUTES } from "@/lib/cadence.ts";
import { formatDateTime } from "@/lib/when.ts";

export type LastRun = NonNullable<Connection["lastRun"]>;
export type RunStatus = LastRun["status"];

/** What `sourceLabel` needs to know about a tenant's connections to tell two accounts apart. */
export type AccountName = Pick<Connection, "source" | "kind" | "externalAccountLabel">;

/**
 * A vendor's own name where we have one; the source's id where we do not -- and, where a
 * tenant holds more than one account of that vendor, which account.
 *
 * `Gmail` for a tenant with one mailbox, `Gmail · ops@acme.test` for one with two, because two
 * lines both reading "Gmail · messages" are a ledger nobody can reconcile. The address comes
 * from `accounts` (the tenant's `connections.list`), since a source names its account only by
 * an opaque digest. A further account whose address is not known -- no list was passed, or the
 * connection is gone -- is qualified by that digest rather than printed as the bare vendor:
 * the digest is ugly, but it is true, and the bare name would claim it was the first account.
 * Label and address are two facts set side by side, not a sentence, so they are joined with
 * the same ` · ` the lake's lines use rather than worded through the catalogue.
 */
export function sourceLabel(source: string, accounts: readonly AccountName[] = []): string {
  const instance = parseSourceInstance(source);
  if (instance === null || !isSource(instance.kind)) {
    return source;
  }
  const name = SOURCE_LABEL[instance.kind];
  const siblings = accounts.filter((account) => account.kind === instance.kind);
  if (instance.account === null && siblings.length < 2) {
    return name;
  }
  const address = siblings.find((account) => account.source === source)?.externalAccountLabel;
  const qualifier = address === undefined || address === "" ? instance.account : address;
  return qualifier === null ? name : `${name} · ${qualifier}`;
}

/**
 * The search parameter the journal's account filter rides in: `/journal?source=gmail.3fa9c1d2e0ab`.
 *
 * In the address, never the store, for the reason the open run is (`Journal.tsx`): Back and
 * Forward restore it and a pasted link opens the same list. A source, not a kind -- one account's
 * runs (ADR 0043), which is what the card it is opened from is about.
 */
const SOURCE_PARAM = "source";

/** The account the journal is filtered to, or `null` for every run. */
export function journalSource(params: URLSearchParams): string | null {
  const source = params.get(SOURCE_PARAM)?.trim() ?? "";
  return source === "" ? null : source;
}

/**
 * Where the journal is: all of it or one account's, optionally with one run open.
 *
 * One function for both halves of the address, so a run opened from a filtered list keeps the
 * filter: a row that dropped it would put every account's runs round the one the reader opened.
 */
export function journalPath(
  tenantId: string,
  at: { source?: string | null; runId?: string | null } = {},
): string {
  const base = divisionPath("journal", tenantId);
  const path = at.runId === undefined || at.runId === null ? base : `${base}/${at.runId}`;
  return at.source === undefined || at.source === null
    ? path
    : `${path}?${new URLSearchParams({ [SOURCE_PARAM]: at.source }).toString()}`;
}

/**
 * The scope a run read with, in the words the card uses for a connection's scope -- or `null`,
 * which the leaf prints as MISSING, for a run that recorded none (ADR 0091).
 *
 * Never the connection's scope today in its place: that is a statement about now, and printed
 * beside a run it would claim that run read with it.
 */
export function runScopeSummary(
  t: TFunction,
  run: Pick<RunDetail, "source" | "scope">,
): string | null {
  const kind = run.source === null ? undefined : parseSourceInstance(run.source)?.kind;
  if (run.scope === null || kind === undefined || !isSource(kind)) {
    return null;
  }
  return scopeSummary(t, kind, run.scope);
}

/**
 * What a run acted on, where the book keeps it: the account an ingest read, or the one model a
 * build from the editor built. `null` for a run with no single target -- a scheduled build of
 * every model, a pass over documents -- which the leaf then does not name at all.
 *
 * A one-model build names its model nowhere but in the step dbt recorded for it: the editor's
 * `--select` is not stored on the run, and `lastBuildPerModel` joins a model to its builds the
 * same way. A build that recorded no single model step (dbt stopped before it compiled one) has
 * a target this cannot name, so its `name` is `null` -- printed as MISSING, never guessed.
 */
export type RunTarget =
  | { readonly kind: "source"; readonly source: string; readonly sourceKind: Source }
  | { readonly kind: "model"; readonly name: string | null };

export function runTarget(run: Pick<RunDetail, "kind" | "source" | "steps">): RunTarget | null {
  if (run.kind === "build") {
    const models = run.steps.filter((step) => step.kind === "model");
    return { kind: "model", name: models.length === 1 ? (models[0]?.name ?? null) : null };
  }
  if (run.kind !== "ingest" || run.source === null) {
    return null;
  }
  const sourceKind = parseSourceInstance(run.source)?.kind;
  return isSource(sourceKind) ? { kind: "source", source: run.source, sourceKind } : null;
}

/**
 * What a run did, as one line of the journal: the source and what it read, or that it was
 * a build of the models. Entity names stay as the source calls them -- `deals`, `contacts`
 * -- because they are identifiers a reader will meet again in the raw lake.
 *
 * `accounts` is the tenant's connections, so a run of the second mailbox says which mailbox;
 * see `sourceLabel`.
 */
export function describeRun(
  t: TFunction,
  run: Pick<RunView, "kind" | "source" | "entities">,
  accounts: readonly AccountName[] = [],
): string {
  const source = run.source === null ? "" : sourceLabel(run.source, accounts);
  switch (run.kind) {
    case "ingest":
      return run.entities.length === 0 ? source : `${source} · ${run.entities.join(", ")}`;
    case "extract":
      return t("journal.kindExtract", { source });
    case "semantic":
      return t("journal.kindSemantic", { source });
    case "semantic-init":
      return t("journal.kindSemanticInit");
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
    return t("when.dueNow", { minutes: TICK_MINUTES });
  }
  return formatDateTime(connection.nextRunAt, locale);
}

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
  type RunEventView,
  type RunView,
  SOURCE_LABEL,
} from "@/api/types.ts";
import type { CardFacts } from "@/lib/connectionState.ts";
import { formatCount, MISSING } from "@/lib/money.ts";
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
 * One count out of an event's detail, formatted for the reader.
 *
 * Anything that is not a number is MISSING rather than a `0`: a count the worker did not
 * send is not a count of nothing, and the two must not look the same. Same rule as
 * `formatMoney`'s, for the same reason.
 */
function counted(detail: Record<string, unknown>, key: string, locale: Locale): string {
  const value = detail[key];
  return formatCount(typeof value === "number" ? value : null, locale);
}

/**
 * What a Drive run looked in, and how far down.
 *
 * `listed` exceeds `folders` exactly when the walk went below the picked folders, and the
 * shallow sentence ends "Sub-folders are not read" -- which would be a false statement about
 * a run that read them. BOTH counts must be numbers for the deep sentence: a run recorded
 * before `listed` existed carries no such key, and reading its absence as "deeper" would put
 * a sentence about sub-folders on a run that never read one. Rule 2 -- no evidence is not a
 * yes, in either direction.
 */
function picksSentence(
  t: TFunction,
  n: (key: string) => string,
  detail: Record<string, unknown>,
): string {
  const { listed, folders } = detail;
  const deeper = typeof listed === "number" && typeof folders === "number" && listed > folders;

  return deeper
    ? t("journal.event.picksListedDeep", {
        listed: n("listed"),
        folders: n("folders"),
        matched: n("matched"),
      })
    : t("journal.event.picksListed", { folders: n("folders"), matched: n("matched") });
}

/**
 * What the run has to read, and how much of it it already held.
 *
 * Two sentences rather than one with a count appended, and for a mechanical reason as well
 * as a linguistic one: `counted` renders an absent number as MISSING, so a single sentence
 * carrying `{{skipped}}` would print MISSING on every run from a source that does not skip.
 * Same shape as `recordsRead` / `recordsReadOf`.
 */
function listedSentence(
  t: TFunction,
  n: (key: string) => string,
  entity: string,
  detail: Record<string, unknown>,
): string {
  return detail.skipped === undefined
    ? t("journal.event.workListed", { entity, total: n("total") })
    : t("journal.event.workListedSkipping", { entity, total: n("total"), skipped: n("skipped") });
}

/**
 * What one entity's read finished with.
 *
 * `skipped` is the count that makes a STEADY-STATE run readable: in steady state an ingest
 * lands nothing, and `landed: 0` on its own reads the same whether the mailbox is empty,
 * the credential is broken, or nothing has changed since yesterday.
 */
function doneSentence(
  t: TFunction,
  n: (key: string) => string,
  entity: string,
  detail: Record<string, unknown>,
): string {
  const counts = {
    entity,
    landed: n("landed"),
    created: n("created"),
    changed: n("changed"),
    refused: n("refused"),
  };
  return detail.skipped === undefined
    ? t("journal.event.entityDone", counts)
    : t("journal.event.entityDoneSkipping", { ...counts, skipped: n("skipped") });
}

/**
 * One line of a run's feed, as a sentence.
 *
 * The worker writes an enumerated verb and a handful of counts; the wording is entirely
 * here, which is what lets the same feed read in Vietnamese and in English without the
 * worker knowing either language. An event this does not know renders as itself rather than
 * disappearing: a feed that silently dropped a line the worker thought worth writing would
 * be the exact failure this whole division exists to fix.
 *
 * Counts arrive pre-formatted through `formatCount`, so an absent one renders as MISSING
 * rather than as a `0` that would read as a real zero. Same reason `formatMoney` does it.
 */
export function eventSentence(
  t: TFunction,
  locale: Locale,
  event: Pick<RunEventView, "event" | "entity" | "detail">,
): string {
  const entity = event.entity ?? "";
  function n(key: string): string {
    return counted(event.detail, key, locale);
  }

  switch (event.event) {
    case "run_opened":
      return t("journal.event.runOpened");
    case "entity_started":
      return t("journal.event.entityStarted", { entity });
    case "work_listed":
      return listedSentence(t, n, entity, event.detail);
    case "records_read":
      return event.detail.total === undefined
        ? t("journal.event.recordsRead", { entity, read: n("read") })
        : t("journal.event.recordsReadOf", { entity, read: n("read"), total: n("total") });
    case "entity_done":
      return doneSentence(t, n, entity, event.detail);
    case "picks_listed":
      return picksSentence(t, n, event.detail);
    case "documents_landed":
      return t("journal.event.documentsLanded", {
        created: n("created"),
        unchanged: n("unchanged"),
        skipped: n("skipped"),
        failed: n("failed"),
      });
    case "no_models":
      return t("journal.event.noModels");
    case "dbt_finished":
      return t("journal.event.dbtFinished", {
        models: n("models"),
        tests: n("tests"),
        testsFailed: n("testsFailed"),
      });
    case "run_closed":
      return event.detail.status === "ok"
        ? t("journal.event.runClosedOk")
        : t("journal.event.runClosedFailed");
    case "run_failed":
      return t("journal.event.runFailed", { errorType: String(event.detail.errorType ?? "") });
    // Its own sentence rather than `runFailed`'s, because the reader's question is different:
    // not "what broke" but "did the deploy lose anything" -- and the counts answer it.
    case "run_stopped":
      return t("journal.event.runStopped", {
        created: n("created"),
        changed: n("changed"),
        refused: n("refused"),
      });
    case "events_truncated":
      return t("journal.event.truncated", { at: n("at") });
    default:
      return t("journal.event.unknown", { event: event.event });
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

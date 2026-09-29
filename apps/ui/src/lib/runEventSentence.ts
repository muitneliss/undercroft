/**
 * A run's feed, worded: one sentence per event the worker writes.
 *
 * The worker writes an enumerated verb and a handful of counts and opaque provider ids; every
 * word the reader sees is chosen here, from the catalogue, so the same feed reads in Vietnamese
 * and in English without the worker knowing either language. Split from `runs.ts`, which words
 * a run from the card's side -- its source, its trigger, its mark, when the next one comes.
 */

import type { Locale } from "@undercroft/core/locale";
import type { TFunction } from "i18next";

import { sourceKind } from "@undercroft/contracts/sources";

import { isSource, type RunEventView } from "@/api/types.ts";
import { connectsBy } from "@/lib/connectionState.ts";
import { formatCount } from "@/lib/money.ts";

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
 * Separate sentences rather than one with counts appended, and for a mechanical reason as well
 * as a linguistic one: `counted` renders an absent number as MISSING, so a single sentence
 * carrying `{{skipped}}` would print MISSING on every run from a source that does not skip.
 * Same shape as `recordsRead` / `recordsReadOf`.
 *
 * The third is a Gmail run reading messages it already holds (ADR 0076): after a file type is
 * added, and once for every mailbox marked before marks said what they left behind. That can be
 * hours of reading on a mailbox the reader thought was synced, so the line says so before it
 * starts rather than leaving "0 already held" to look like a lost mailbox. Only when the count
 * is above zero, since in steady state it is zero on every run.
 */
function listedSentence(
  t: TFunction,
  n: (key: string) => string,
  entity: string,
  detail: Record<string, unknown>,
): string {
  if (detail.skipped === undefined) {
    return t("journal.event.workListed", { entity, total: n("total") });
  }
  const counts = { entity, total: n("total"), skipped: n("skipped") };
  return typeof detail.reread === "number" && detail.reread > 0
    ? t("journal.event.workListedRereading", { ...counts, reread: n("reread") })
    : t("journal.event.workListedSkipping", counts);
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

/** What a Google run's documents did, beside its records. */
function documentsSentence(t: TFunction, n: (key: string) => string): string {
  return t("journal.event.documentsLanded", {
    created: n("created"),
    unchanged: n("unchanged"),
    skipped: n("skipped"),
    failed: n("failed"),
  });
}

/** What reading held messages again bought: how many, and the attachments new to the lake. */
function rereadSentence(t: TFunction, n: (key: string) => string, entity: string): string {
  return t("journal.event.recordsReread", { entity, reread: n("reread"), landed: n("landed") });
}

/** How far one entity's read has got, against a total only where the run stated one. */
function readSentence(
  t: TFunction,
  n: (key: string) => string,
  entity: string,
  detail: Record<string, unknown>,
): string {
  return detail.total === undefined
    ? t("journal.event.recordsRead", { entity, read: n("read") })
    : t("journal.event.recordsReadOf", { entity, read: n("read"), total: n("total") });
}

/**
 * A list the run did not read because the grant lacks its scope: a recorded grant judged before
 * the run (ADR 0073), or a pasted token its source refused on the list's first request (ADR 0075).
 *
 * Names the scope, because granting it is the repair. How it is granted depends on how the source
 * is connected: a consent is given again by reconnecting, while a HubSpot private app's scopes
 * are ticked in HubSpot, and "reconnect" would send that reader to a screen that cannot add one.
 * A detail with no scope still reads as a sentence, with the scope left empty, rather than as the
 * raw event name.
 */
function notGrantedSentence(
  t: TFunction,
  entity: string,
  detail: Record<string, unknown>,
  source: string | null | undefined,
): string {
  const scope = typeof detail.scope === "string" ? detail.scope : "";
  return grantedBy(source) === "token"
    ? t("journal.event.entityNotGrantedToken", { entity, scope })
    : t("journal.event.entityNotGranted", { entity, scope });
}

/**
 * How the run's source grants a scope: by a consent, or by the token an admin pasted. A source
 * this build does not know is taken to consent, which is how every source but HubSpot connects.
 */
export function grantedBy(source: string | null | undefined): "consent" | "token" {
  const kind = sourceKind(source ?? "");
  return isSource(kind) ? connectsBy(kind) : "consent";
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
 *
 * `source` is the run's, and only a missing permission's remedy depends on it.
 */
/** How the run ended: closed, broke, or stopped by the worker shutting down. */
function endSentence(
  t: TFunction,
  event: "run_closed" | "run_failed" | "run_stopped",
  detail: Record<string, unknown>,
  n: (key: string) => string,
): string {
  if (event === "run_closed") {
    return detail.status === "ok"
      ? t("journal.event.runClosedOk")
      : t("journal.event.runClosedFailed");
  }
  if (event === "run_failed") {
    return t("journal.event.runFailed", { errorType: String(detail.errorType ?? "") });
  }
  // Its own sentence rather than `runFailed`'s, because the reader's question is different:
  // not "what broke" but "did the deploy lose anything" -- and the counts answer it.
  return t("journal.event.runStopped", {
    created: n("created"),
    changed: n("changed"),
    refused: n("refused"),
  });
}

/**
 * A whole read the day's request budget cut short, or a list that waited for a day with room
 * (ADR 0082): what a reader needs to know is that the list is not finished and when it will be.
 */
function wholeReadSentence(
  t: TFunction,
  event: "whole_read_paused" | "whole_read_waiting",
  entity: string,
  n: (key: string) => string,
): string {
  return event === "whole_read_paused"
    ? t("journal.event.wholeReadPaused", { entity, requests: n("requests") })
    : t("journal.event.wholeReadWaiting", { entity });
}

export function eventSentence(
  t: TFunction,
  locale: Locale,
  event: Pick<RunEventView, "event" | "entity" | "detail">,
  source?: string | null,
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
      return readSentence(t, n, entity, event.detail);
    case "entity_done":
      return doneSentence(t, n, entity, event.detail);
    case "entity_not_granted":
      return notGrantedSentence(t, entity, event.detail, source);
    case "picks_listed":
      return picksSentence(t, n, event.detail);
    case "documents_landed":
      return documentsSentence(t, n);
    case "records_reread":
      return rereadSentence(t, n, entity);
    case "whole_read_paused":
    case "whole_read_waiting":
      return wholeReadSentence(t, event.event, entity, n);
    case "run_waiting":
      return t("journal.event.runWaiting", { waiting: n("waiting") });
    case "no_models":
      return t("journal.event.noModels");
    case "dbt_finished":
      return t("journal.event.dbtFinished", {
        models: n("models"),
        tests: n("tests"),
        testsFailed: n("testsFailed"),
      });
    case "run_closed":
    case "run_failed":
    case "run_stopped":
      return endSentence(t, event.event, event.detail, n);
    case "events_truncated":
      return t("journal.event.truncated", { at: n("at") });
    default:
      return t("journal.event.unknown", { event: event.event });
  }
}

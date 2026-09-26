/**
 * The per-client Gmail legs: SOURCE <-> OSTWIN, SOURCE <-> UNDERCROFT and OSTWIN <-> UNDERCROFT
 * for one client in one mailbox.
 *
 * WHAT EACH SYSTEM PROMISES, WHICH IS NOT THE SAME THING.
 * - OSTWIN promises every message its declared routes find (`scope`, `label`, `attachment`
 *   queries, plus `thread_sibling` and `referral` derivations), minus what attribution
 *   discards, never Spam or Trash (the old warehouse's Gmail ingest contract).
 * - Undercroft promises every message carrying a label in its connection's list. It knows
 *   nothing of clients.
 * So S->O is judged against OSTWIN's own queries, S->U against Undercroft's own labels, and
 * O->U only over the part both promised: OSTWIN's messages under a label Undercroft reads,
 * dated before Undercroft's last completed run.
 *
 * THE REFERENCE IS THE LIVE MAILBOX, READ NOW. OSTWIN's query text is taken from its own
 * coverage record -- the definition under test -- but the answer comes from Gmail. A scope hit
 * OSTWIN lacks is MISSING only when older than OSTWIN's harvest and not on its discard list;
 * `label` and `attachment` hits are candidates attribution may refuse, so their absence is
 * EXCLUDED_BY_RULE.
 */

import { type Keyed, reconcileLeg } from "./classify.ts";
import { mapLimit } from "./concurrency.ts";
import type { ClientConfig } from "./config.ts";
import type { GmailMessage } from "./gmail.ts";
import {
  atOrBefore,
  base,
  blocked,
  type GmailDeps,
  legCase,
  type MailboxRead,
  type MailboxState,
  type OstwinMessage,
  pushDiff,
  sourceRunTime,
  squash,
} from "./gmailCommon.ts";
import { arrayOrEmpty, asObject, text } from "./json.ts";
import { letterKey, messageKey } from "./keys.ts";
import type { FieldDiff, TestResult } from "./model.ts";
import { o2uCase, s2uCase } from "./gmailLakeLegs.ts";
import { type OstwinCase, ostwinPagingCase, readOstwin } from "./gmailOstwin.ts";

const QUERY_ROUTES = new Set(["scope", "label", "attachment"]);
const CONCURRENCY = 4;

export async function clientCases(
  deps: GmailDeps,
  client: ClientConfig,
  states: readonly MailboxState[],
): Promise<TestResult[]> {
  if (client.caseId === null) {
    return [noCaseId(client)];
  }
  const ostwin = await readOstwin(deps, client.caseId);
  const results = [ostwinPagingCase(deps, client, ostwin)];
  for (const state of states) {
    if (state.identityOk) {
      const read = await readMailbox(deps, state, ostwin);
      results.push(
        s2oCase(deps, client, read),
        s2uCase(deps, client, read),
        o2uCase(deps, client, read),
      );
    } else {
      for (const leg of ["S2O", "S2U", "O2U"] as const) {
        results.push(
          blocked(`GM-${client.label}-${leg}-${state.name}`, client, leg, state.identityReason),
        );
      }
    }
  }
  return results;
}

function noCaseId(client: ClientConfig): TestResult {
  return base(`GM-${client.label}-S2O-001`, "OSTWIN holds a Gmail harvest for this client", {
    leg: "S2O",
    client: client.label,
    requirement: "REQ-GM-02 OSTWIN harvests each active client's mail",
    contract: "old-warehouse Gmail ingest contract: one source candidate per CASE-ID",
    preconditions: "client has an OSTWIN CASE-ID",
    expected: "a Gmail source candidate exists",
    actual: "client has no CASE-ID, so OSTWIN has no Gmail source candidate for it",
    status: "BLOCKED",
    reason: "no CASE-ID: OSTWIN cannot be asked; recorded as an OSTWIN coverage gap",
    evidence: [],
  });
}

/** Ask Gmail, now, each query OSTWIN declares for this mailbox. */
async function askQueries(
  deps: GmailDeps,
  state: MailboxState,
  routes: readonly Record<string, unknown>[],
): Promise<{ found: Map<string, Set<string>>; complete: boolean }> {
  const found = new Map<string, Set<string>>();
  let complete = true;
  for (const route of routes) {
    const name = text(route.route);
    const query = text(route.query);
    if (QUERY_ROUTES.has(name) && query.length > 0) {
      const walk = await deps.google[state.name].listMessages({
        q: query,
        includeSpamTrash: false,
      });
      complete &&= walk.exhausted;
      for (const key of walk.items.map((raw) => messageKey(state.name, raw))) {
        if (key !== null) {
          found.set(key, (found.get(key) ?? new Set()).add(name));
        }
      }
    }
  }
  return { found, complete };
}

async function readMailbox(
  deps: GmailDeps,
  state: MailboxState,
  ostwin: OstwinCase,
): Promise<MailboxRead> {
  const coverage = ostwin.candidate.find((row) => row.mailbox === state.name);
  const discarded = new Map<string, string>();
  for (const item of arrayOrEmpty(coverage?.discarded).map(asObject)) {
    discarded.set(text(item.message_id), `${text(item.reason)} (route ${text(item.route)})`);
  }
  const { found, complete } = await askQueries(
    deps,
    state,
    arrayOrEmpty(coverage?.routes).map(asObject),
  );
  const mine = new Map<string, OstwinMessage>();
  for (const message of ostwin.messages.filter((row) => row.mailbox === state.name)) {
    const key = messageKey(state.name, message.messageId);
    if (key !== null) {
      mine.set(key, message);
    }
  }
  const wanted = [...new Set([...found.keys(), ...mine.keys()])];
  const fetched = await mapLimit(
    wanted,
    CONCURRENCY,
    async (key) =>
      [key, await deps.google[state.name].getMessage(key.slice(state.name.length + 1))] as const,
  );
  const harvest = ostwin.harvests.find((row) => row.mailbox === state.name);
  return {
    state,
    found,
    listingComplete: complete,
    source: new Map(fetched),
    ostwin: mine,
    discarded,
    harvest,
    unpublished: ostwin.unpublished,
  };
}

function s2oReference(read: MailboxRead): Keyed<GmailMessage & { routes: ReadonlySet<string> }>[] {
  const reference: Keyed<GmailMessage & { routes: ReadonlySet<string> }>[] = [];
  const keys = new Set([...read.found.keys(), ...read.ostwin.keys()]);
  for (const key of keys) {
    const message = read.source.get(key);
    // Rows OSTWIN reached by derivation (thread_sibling, referral) join the reference when
    // Gmail still has them; one Gmail no longer has stays target-only and surfaces as EXTRA.
    const routes = read.found.get(key) ?? new Set([read.ostwin.get(key)?.route ?? "derived"]);
    if (message !== null && message !== undefined) {
      reference.push({
        key,
        record: { ...message, routes },
        evidence: `gmail routes=${[...routes].join(",")}`,
      });
    }
  }
  return reference;
}

function seconds(ms: number): string {
  return Number.isNaN(ms) ? "" : String(Math.floor(ms / 1000));
}

function compareOstwin(source: GmailMessage, ostwin: OstwinMessage): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  pushDiff(diffs, "thread_id", source.threadId, ostwin.threadId);
  pushDiff(
    diffs,
    "rfc822_message_id",
    letterKey(source.headers["Message-ID"]),
    letterKey(ostwin.rfc822MessageId),
  );
  pushDiff(diffs, "subject", squash(source.headers.Subject), squash(ostwin.subject));
  pushDiff(
    diffs,
    "message_time",
    seconds(Number.parseInt(source.internalDate, 10)),
    seconds(Date.parse(ostwin.messageTime ?? "")),
  );
  return diffs;
}

function s2oCase(deps: GmailDeps, client: ClientConfig, read: MailboxRead): TestResult {
  const id = `GM-${client.label}-S2O-${read.state.name}`;
  if (read.harvest === undefined) {
    return blocked(id, client, "S2O", "OSTWIN mart has no coverage row for this mailbox");
  }
  const harvestAt = sourceRunTime(read.harvest.source_run ?? null);
  const reference = s2oReference(read);
  const prefix = read.state.name.length + 1;
  const records = reconcileLeg({
    reference,
    target: [...read.ostwin.entries()].map(([key, row]) => ({
      key,
      record: row,
      evidence: `ostwin:gmail_message_evidence source_run=${row.sourceRun ?? "?"}`,
    })),
    inScope: () => ({ inScope: true, reason: "" }),
    excludedBy: (key, record) => {
      const rule = read.discarded.get(key.slice(prefix));
      if (rule !== undefined) {
        return `OSTWIN discard: ${rule}`;
      }
      return record.routes.has("scope")
        ? null
        : `found only by candidate route(s) ${[...record.routes].join(",")}; attribution did not claim it`;
    },
    pendingReason: (key) =>
      read.unpublished.ids.has(key.slice(prefix))
        ? `held in OSTWIN's newer harvest ${read.unpublished.sourceRun} (state ${read.unpublished.state}), not yet published to the mart`
        : null,
    synced: (record) => atOrBefore(Number.parseInt(record.internalDate, 10), harvestAt),
    compare: compareOstwin,
    targetBelongs: () => true,
  });
  return legCase(
    deps,
    {
      id,
      title: `Gmail source vs OSTWIN, ${read.state.name} mailbox`,
      leg: "S2O",
      client: client.label,
      requirement: "REQ-GM-02 OSTWIN holds every message its declared routes find",
      contract:
        "old-warehouse Gmail ingest contract: routes scope/label/attachment/thread_sibling/referral; Spam/Trash excluded",
      preconditions: `identity verified; OSTWIN harvest ${read.harvest.source_run ?? "unknown"} (${read.harvest.mode ?? "?"})`,
      expected:
        "no MISSING scope hit older than the harvest; no OSTWIN row absent from the mailbox; fields equal",
      actual: `reference ${reference.length}, OSTWIN ${read.ostwin.size}`,
    },
    records,
    read.listingComplete && read.harvest.pagination_exhausted === "1",
  );
}

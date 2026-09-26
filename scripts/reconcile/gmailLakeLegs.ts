/**
 * The two per-client Gmail legs that end in the lake: S->U (the client's scope-query messages
 * against the lake, under Undercroft's label scope and watermark) and O->U (OSTWIN's messages
 * against the lake, over the scope both promised).
 *
 * The lake is read strictly: its contract stores `Message-ID` under that name, so a lake row
 * keyed any other way is a difference, not something to normalise away.
 */

import { type Keyed, reconcileLeg } from "./classify.ts";
import type { ClientConfig } from "./config.ts";
import type { GmailMessage } from "./gmail.ts";
import {
  atOrBefore,
  blocked,
  type GmailDeps,
  type LakeMessage,
  lakeMessage,
  legCase,
  type MailboxRead,
  type MailboxState,
  pushDiff,
  squash,
} from "./gmailCommon.ts";
import { letterKey } from "./keys.ts";
import type { FieldDiff, TestResult } from "./model.ts";

function compareLake(source: GmailMessage, lake: LakeMessage): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  pushDiff(diffs, "threadId", source.threadId, lake.threadId);
  pushDiff(diffs, "internalDate", source.internalDate, lake.internalDate);
  // The lake is read strictly: its contract stores `Message-ID` under that name, so a lake
  // row keyed any other way is a difference, not something to normalise away.
  pushDiff(
    diffs,
    "Message-ID",
    letterKey(source.headers["Message-ID"]),
    letterKey(lake.headers["Message-ID"]),
  );
  pushDiff(diffs, "Subject", squash(source.headers.Subject), squash(lake.headers.Subject));
  pushDiff(diffs, "From", squash(source.headers.From), squash(lake.headers.From));
  return diffs;
}

function lakeCopies<T>(state: MailboxState, reference: readonly Keyed<T>[]): Keyed<LakeMessage>[] {
  return reference.flatMap((entry) =>
    (state.byKey.get(entry.key) ?? []).map((row) => ({
      key: entry.key,
      record: lakeMessage(row),
      evidence: `lake:${row.source}/messages/${row.sourceRecordId} run=${row.runId}`,
    })),
  );
}

export function s2uCase(deps: GmailDeps, client: ClientConfig, read: MailboxRead): TestResult {
  const { state } = read;
  const id = `GM-${client.label}-S2U-${state.name}`;
  if (state.lake === null) {
    return blocked(id, client, "S2U", `lake unreadable: ${state.lakeError ?? ""}`);
  }
  const scope = new Set(state.labels);
  const reference: Keyed<GmailMessage>[] = [];
  for (const [key, routes] of read.found) {
    const message = read.source.get(key);
    if (routes.has("scope") && message !== null && message !== undefined) {
      reference.push({ key, record: message, evidence: "gmail:q route=scope" });
    }
  }
  const records = reconcileLeg({
    reference,
    target: lakeCopies(state, reference),
    inScope: (message) => ({
      inScope: message.labelIds.some((label) => scope.has(label)),
      reason: `labels ${message.labelIds.join(",") || "(none)"} not in Undercroft's label scope`,
    }),
    synced: (message) => atOrBefore(Number.parseInt(message.internalDate, 10), state.watermark),
    compare: compareLake,
    targetBelongs: () => false,
  });
  return legCase(
    deps,
    {
      id,
      title: `Gmail source vs Undercroft, ${state.name} mailbox, this client's messages`,
      leg: "S2U",
      client: client.label,
      requirement: "REQ-GM-03 Undercroft holds every in-scope message",
      contract:
        "Undercroft gmail connector label scope; payload headers To/Date/From/Subject/Message-ID",
      preconditions: `identity verified; Undercroft watermark ${state.watermark ?? "unknown"}`,
      expected:
        "each client message under an Undercroft label, older than the watermark, present once with equal headers",
      actual: `reference ${reference.length}`,
    },
    records,
    state.watermark !== null && state.lake.exhausted,
  );
}

/** OSTWIN's messages that Undercroft also promised: labels it reads, before its watermark. */
export function o2uCase(deps: GmailDeps, client: ClientConfig, read: MailboxRead): TestResult {
  const { state } = read;
  const id = `GM-${client.label}-O2U-${state.name}`;
  if (state.lake === null) {
    return blocked(id, client, "O2U", `lake unreadable: ${state.lakeError ?? ""}`);
  }
  const scope = new Set(state.labels);
  const reference = [...read.ostwin.entries()].map(([key, row]) => ({
    key,
    record: row,
    evidence: `ostwin:gmail_message_evidence source_run=${row.sourceRun ?? "?"}`,
  }));
  const records = reconcileLeg({
    reference,
    target: lakeCopies(state, reference),
    inScope: (row) => ({
      inScope: (row.labels ?? "").split(";").some((label) => scope.has(label)),
      reason: "OSTWIN's recorded labels hold no label Undercroft reads",
    }),
    synced: (row) => atOrBefore(Date.parse(row.messageTime ?? ""), state.watermark),
    compare: (row, lake) => {
      const diffs: FieldDiff[] = [];
      pushDiff(diffs, "thread_id", row.threadId, lake.threadId);
      pushDiff(
        diffs,
        "rfc822_message_id",
        letterKey(row.rfc822MessageId),
        letterKey(lake.headers["Message-ID"]),
      );
      pushDiff(diffs, "subject", squash(row.subject), squash(lake.headers.Subject));
      return diffs;
    },
    targetBelongs: () => false,
  });
  return legCase(
    deps,
    {
      id,
      title: `OSTWIN vs Undercroft, ${state.name} mailbox, over their common scope`,
      leg: "O2U",
      client: client.label,
      requirement: "REQ-GM-05 the two warehouses agree where both promise the message",
      contract:
        "intersection: OSTWIN client messages x Undercroft label scope x Undercroft watermark",
      preconditions: `OSTWIN mart rows present; Undercroft watermark ${state.watermark ?? "unknown"}`,
      expected:
        "every common-scope OSTWIN message present once in the lake with equal thread, Message-ID, subject",
      actual: `OSTWIN ${reference.length}`,
    },
    records,
    state.watermark !== null && state.lake.exhausted,
  );
}

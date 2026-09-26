/**
 * The whole mailbox against the whole lake source: every message holding a label Undercroft
 * reads must be in the lake, once, whichever client it concerns -- the case that catches a
 * connector dropping pages or labels.
 *
 * A lake row whose own labels never included a label Undercroft reads is a scope breach
 * (EXTRA); one that did, and has since been relabelled or expired from Spam, is retained
 * history and is counted, not reported.
 */

import { reconcileLeg } from "./classify.ts";
import { mapLimit } from "./concurrency.ts";
import type { GmailMessage } from "./gmail.ts";
import {
  atOrBefore,
  base,
  type GmailDeps,
  type LakeMessage,
  lakeMessage,
  legCase,
  type MailboxState,
} from "./gmailCommon.ts";
import { messageKey } from "./keys.ts";
import type { RecordResult, TestResult } from "./model.ts";

const CONCURRENCY = 4;

interface LabelListing {
  /** Message key -> the Undercroft labels it was listed under. */
  readonly listed: ReadonlyMap<string, readonly string[]>;
  readonly complete: boolean;
  readonly facts: readonly Record<string, unknown>[];
}

/** One listing per Undercroft label, unioned -- the connector's own contract, asked of Gmail. */
async function listByLabels(deps: GmailDeps, state: MailboxState): Promise<LabelListing> {
  const listed = new Map<string, string[]>();
  const facts: Record<string, unknown>[] = [];
  let complete = true;
  for (const label of state.labels) {
    const walk = await deps.google[state.name].listMessages({
      labelIds: [label],
      includeSpamTrash: label === "SPAM" || label === "TRASH",
    });
    complete &&= walk.exhausted;
    facts.push({ label, found: walk.items.length, pages: walk.pages, exhausted: walk.exhausted });
    for (const raw of walk.items) {
      const key = messageKey(state.name, raw);
      if (key !== null) {
        listed.set(key, [...(listed.get(key) ?? []), label]);
      }
    }
  }
  return { listed, complete, facts };
}

function blockedMailbox(state: MailboxState): string | null {
  if (!state.identityOk) {
    return state.identityReason;
  }
  if (state.lake === null) {
    return `lake unreadable: ${state.lakeError ?? ""}`;
  }
  return state.labels.length === 0 ? "Undercroft connection lists no labels" : null;
}

const MAILBOX_LEG = {
  requirement: "REQ-GM-03 Undercroft holds every in-scope message of each mailbox",
  contract: "Undercroft gmail connector: one listing per configured label, unioned; headers only",
};

/**
 * The whole mailbox against the whole lake source: every message holding a label Undercroft
 * reads must be in the lake, once. A lake row whose own labels never included a label Undercroft
 * reads is a scope breach (EXTRA); one that did, and has since been relabelled or expired from
 * Spam, is retained history and is counted, not reported.
 */
interface Compared {
  readonly records: RecordResult[];
  /** How many lake rows the source holds for this mailbox. */
  readonly lake: number;
  /** Lake rows that carried an Undercroft label once and no longer do: history, not breach. */
  readonly retained: number;
}

async function compareWithLake(
  deps: GmailDeps,
  state: MailboxState,
  listing: LabelListing,
): Promise<Compared> {
  // Only listed messages the lake lacks need their dates, to tell late from missing.
  const absent = [...listing.listed.keys()].filter((key) => !state.byKey.has(key));
  const google = deps.google[state.name];
  const fetched = await mapLimit(
    absent,
    CONCURRENCY,
    async (key) => [key, await google.getMessage(key.slice(state.name.length + 1))] as const,
  );
  const dates = new Map<string, GmailMessage | null>(fetched);
  const scope = new Set(state.labels);
  const target = [...state.byKey.entries()].flatMap(([key, rows]) =>
    rows.map((row) => ({
      key,
      record: lakeMessage(row),
      evidence: `lake:${row.source}/messages/${row.sourceRecordId} run=${row.runId}`,
    })),
  );
  const records = reconcileLeg<string, LakeMessage>({
    reference: [...listing.listed.entries()].map(([key, labels]) => ({
      key,
      record: key,
      evidence: `gmail:list labelIds=${labels.join(",")}`,
    })),
    target,
    inScope: () => ({ inScope: true, reason: "" }),
    excludedBy: (key) =>
      dates.get(key) === null ? "deleted from the mailbox during the run" : null,
    synced: (key) =>
      atOrBefore(Number.parseInt(dates.get(key)?.internalDate ?? "", 10), state.watermark),
    compare: () => [],
    targetBelongs: (message) => !message.labelIds.some((label) => scope.has(label)),
  });
  const retained = target.filter(
    (entry) =>
      !listing.listed.has(entry.key) && entry.record.labelIds.some((label) => scope.has(label)),
  ).length;
  return { records, lake: target.length, retained };
}

export async function mailboxCompletenessCase(
  deps: GmailDeps,
  state: MailboxState,
): Promise<TestResult> {
  const id = `GM-S2U-MBX-001-${state.name}`;
  const title = `Every ${state.name} message under an Undercroft label is in the lake, once`;
  const why = blockedMailbox(state);
  if (why !== null) {
    return base(id, title, {
      leg: "S2U",
      ...MAILBOX_LEG,
      preconditions: "identity verified; lake readable; labels known",
      expected: "no MISSING / DUPLICATE / EXTRA",
      actual: "not run",
      status: "BLOCKED",
      reason: why,
      evidence: [],
    });
  }
  const listing = await listByLabels(deps, state);
  const { records, lake, retained } = await compareWithLake(deps, state, listing);
  const facts = deps.sink.json(`${id}-facts`, {
    labels: state.labels,
    listings: listing.facts,
    listed: listing.listed.size,
    lake,
    retainedHistory: retained,
    watermark: state.watermark,
  });
  const result = legCase(
    deps,
    {
      id,
      title,
      leg: "S2U",
      ...MAILBOX_LEG,
      preconditions: `identity verified; Undercroft watermark ${state.watermark ?? "unknown"}`,
      expected: "every listed message present once; nothing held outside the label scope",
      actual: `listed ${listing.listed.size}, lake ${lake}, retained history ${retained}`,
    },
    records,
    listing.complete && state.watermark !== null,
  );
  return { ...result, evidence: [...result.evidence, { label: "listing facts", path: facts }] };
}

/**
 * The whole mailbox against the whole lake source: every message holding a label Undercroft
 * reads must be in the lake, once, with the fields the connector keeps. The case that catches a
 * connector dropping pages, labels or header values.
 *
 * WHAT THE CONNECTOR PROMISES (worker `google/gmail.ts`, v1.43.0): one paged listing per
 * selected label, unioned; each message read with `format=full`; a record of `id`, `threadId`,
 * `labelIds`, `internalDate` and six headers (`From`, `To`, `Cc`, `Subject`, `Date`,
 * `Message-ID`). A message it already holds is not read again, so its `labelIds` are the labels
 * it had when it landed: labels are not compared. Nothing is ever tombstoned.
 *
 * ABSENCE IS NOT MISSING HERE. MISSING needs the label selection each run read, and the time a
 * message took its label. Undercroft records neither (`runs get` keeps no scope, `connections`
 * only the current one) and Gmail says when a message arrived, not when it was labelled. So an
 * in-label message older than the last completed run and absent from the lake is BLOCKED with
 * that reason; one newer is NOT_YET_SYNCED. A lake row the listings do not return is retained
 * history when its own labels held a selected label (the connector keeps what it read), and
 * BLOCKED when they never held one of the current selection (the selection may have changed).
 *
 * The mailbox itself is read in `gmailSource.ts`, once, for this leg and the attachments leg.
 */

import { reconcileLeg } from "./classify.ts";
import { CONNECTOR_HEADERS, type FullMessage } from "./gmail.ts";
import {
  atOrBefore,
  base,
  type GmailDeps,
  type LakeMessage,
  lakeMessage,
  legCase,
  type MailboxState,
} from "./gmailCommon.ts";
import type { SourceRead } from "./gmailSource.ts";
import type { FieldDiff, RecordResult, TestResult } from "./model.ts";

const ABSENT = "(absent)";

export const NO_SCOPE_HISTORY =
  "older than the last completed run, but Undercroft keeps no record of the label selection each run read, and Gmail does not say when the message took its label";
export const RETAINED = "retained by policy";

/** The connector's fields, the source's value against the lake's, exactly as each holds it. */
export function compareMessage(source: FullMessage, lake: LakeMessage): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  function differ(field: string, expected: string, actual: string): void {
    if (expected !== actual) {
      diffs.push({ field, expected, actual });
    }
  }
  differ("id", source.id, lake.id);
  differ("threadId", source.threadId, lake.threadId);
  differ("internalDate", source.internalDate, lake.internalDate);
  for (const name of CONNECTOR_HEADERS) {
    const values = source.headerValues[name] ?? [];
    const held = Object.hasOwn(lake.headers, name) ? lake.headers[name] : undefined;
    if (values.length === 0) {
      differ(`headers.${name}`, ABSENT, held ?? ABSENT);
    } else if (held === undefined || !values.includes(held)) {
      // A header a sender repeats is kept once; any of its values is the source's own value.
      differ(`headers.${name}`, values.at(-1) ?? "", held ?? ABSENT);
    }
  }
  return diffs;
}

function blockedMailbox(state: MailboxState): string | null {
  if (!state.identityOk) {
    return state.identityReason;
  }
  if (state.lake === null) {
    return `lake unreadable: ${state.lakeError ?? ""}`;
  }
  if (state.unmatchedLabels > 0) {
    // Counted, never named: a label's name is the customer's own words.
    return `${state.unmatchedLabels} chosen label(s) match no Gmail label by id or name, so the selection cannot be listed`;
  }
  return state.labels.length === 0 ? "Undercroft connection lists no labels" : null;
}

/** Whether the mailbox can be read and compared at all; the reason when it cannot. */
export function mailboxBlocker(state: MailboxState): string | null {
  return blockedMailbox(state);
}

const MAILBOX_LEG = {
  requirement: "REQ-GM-02 Undercroft holds every in-scope message of each mailbox",
  contract:
    "Undercroft gmail connector v1.43.0: one listing per selected label, unioned; format=full; id, threadId, internalDate and six headers kept; held messages not re-read; no tombstones",
};

/** A lake row the listings did not return: history the connector keeps, or undecidable. */
function judgeLakeOnly(
  read: SourceRead,
  scope: ReadonlySet<string>,
  key: string,
  lake: LakeMessage,
): { verdict: RecordResult["verdict"]; reason: string } {
  if (!lake.labelIds.some((label) => scope.has(label))) {
    return {
      verdict: "BLOCKED",
      reason:
        "extra_unresolved: held with none of the currently selected labels; Undercroft keeps no history of the selection, so whether it covered the message when it landed cannot be shown",
    };
  }
  if (read.unreadable.has(key) || !read.messages.has(key)) {
    return { verdict: "BLOCKED", reason: "the message could not be read from Gmail" };
  }
  const now = read.messages.get(key) ?? null;
  if (now === null) {
    return {
      verdict: "OUT_OF_SCOPE",
      reason: `${RETAINED}: deleted from the mailbox; the connector never tombstones a message`,
    };
  }
  if (now.labelIds.includes("TRASH")) {
    return { verdict: "OUT_OF_SCOPE", reason: `${RETAINED}: moved to Trash since it landed` };
  }
  if (!now.labelIds.some((label) => scope.has(label))) {
    return {
      verdict: "OUT_OF_SCOPE",
      reason: `${RETAINED}: left the label selection since it landed; the connector does not re-read a held message`,
    };
  }
  return {
    verdict: "BLOCKED",
    reason: "carries a selected label in Gmail, yet no label listing returned it",
  };
}

interface Compared {
  readonly records: RecordResult[];
  readonly lake: number;
  readonly labelDrift: number;
  readonly repeatedHeaders: number;
}

function compareWithLake(state: MailboxState, read: SourceRead): Compared {
  const scope = new Set(state.labels);
  const target = [...state.byKey.entries()].flatMap(([key, rows]) =>
    rows.map((row) => ({
      key,
      record: lakeMessage(row),
      evidence: `lake:${row.source}/messages/${row.sourceRecordId} run=${row.runId} sha=${row.contentSha256} observed=${row.observedAt}`,
    })),
  );
  const unreadableListed = new Set(
    [...read.listed.keys()].filter((key) => read.unreadable.has(key)),
  );
  const records = reconcileLeg<string, LakeMessage>({
    reference: [...read.listed.entries()]
      .filter(([key]) => !unreadableListed.has(key))
      .map(([key, labels]) => ({
        key,
        record: key,
        evidence: `gmail:list labelIds=${labels.join(",")}`,
      })),
    target: target.filter((entry) => !unreadableListed.has(entry.key)),
    inScope: () => ({ inScope: true, reason: "" }),
    excludedBy: (key) =>
      read.messages.get(key) === null ? "deleted from the mailbox during the run" : null,
    synced: (key) =>
      atOrBefore(Number.parseInt(read.messages.get(key)?.internalDate ?? "", 10), state.watermark),
    undecided: () => NO_SCOPE_HISTORY,
    compare: (key, lake) => {
      const now = read.messages.get(key);
      return now === null || now === undefined ? [] : compareMessage(now, lake);
    },
    judgeExtra: (key, lake) => judgeLakeOnly(read, scope, key, lake),
  });
  for (const key of unreadableListed) {
    records.push({
      key,
      verdict: "BLOCKED",
      reason: "listed under a selected label, but the message could not be read from Gmail",
      diffs: [],
      evidence: {},
    });
  }
  let labelDrift = 0;
  let repeatedHeaders = 0;
  for (const entry of target) {
    const now = read.messages.get(entry.key);
    if (now === null || now === undefined) {
      continue;
    }
    const before = [...entry.record.labelIds].sort().join(",");
    if (before !== [...now.labelIds].sort().join(",")) {
      labelDrift += 1;
    }
    if (Object.values(now.headerValues).some((values) => values.length > 1)) {
      repeatedHeaders += 1;
    }
  }
  return { records, lake: target.length, labelDrift, repeatedHeaders };
}

export function mailboxCompletenessCase(
  deps: GmailDeps,
  state: MailboxState,
  read: SourceRead | null,
): TestResult {
  const id = `GM-S2U-MBX-001-${state.name}`;
  const title = `Every ${state.name} message under an Undercroft label is in the lake, once, with the connector's fields`;
  const why = blockedMailbox(state) ?? (read === null ? "the mailbox was not read" : null);
  if (why !== null || read === null) {
    return base(id, title, {
      leg: "S2U",
      ...MAILBOX_LEG,
      preconditions: "identity verified; lake readable; labels known",
      expected: "no MISSING / DUPLICATE / EXTRA / CONTENT_MISMATCH",
      actual: "not run",
      status: "BLOCKED",
      reason: why ?? "the mailbox was not read",
      evidence: [],
    });
  }
  const { records, lake, labelDrift, repeatedHeaders } = compareWithLake(state, read);
  const retained = records.filter((record) => record.reason.startsWith(RETAINED)).length;
  const facts = deps.sink.json(`${id}-facts`, {
    labels: state.labels,
    listings: read.labels,
    listed: read.listed.size,
    lake,
    retainedByPolicy: retained,
    labelDriftSinceLanding: labelDrift,
    messagesWithARepeatedHeader: repeatedHeaders,
    unreadable: read.unreadable.size,
    watermark: state.watermark,
    readComplete: {
      source: read.complete ? "exact_total" : "no",
      target: state.lake?.exhausted === true ? "cursor" : "no",
    },
  });
  const result = legCase(
    deps,
    {
      id,
      title,
      leg: "S2U",
      ...MAILBOX_LEG,
      preconditions: `identity verified; Undercroft watermark ${state.watermark ?? "unknown"}`,
      expected:
        "every listed message present once with equal fields; nothing held that the connector's policy does not explain",
      actual: `listed ${read.listed.size}, lake ${lake}, retained by policy ${retained}, listings proven complete: ${read.complete}`,
    },
    records,
    read.complete && state.watermark !== null,
  );
  return { ...result, evidence: [...result.evidence, { label: "listing facts", path: facts }] };
}

/**
 * The mailbox-level Gmail cases that need no message read from Gmail: whose mailbox a token
 * reads, whether the lake source was read to its end, and whether a Gmail id ever names two
 * different letters across the two mailboxes (#143). The mailbox itself is compared in
 * `gmailCompleteness.ts` and `gmailAttachments.ts`.
 */

import type { MailboxName } from "./config.ts";
import { messageOf } from "./errors.ts";
import { base, type GmailDeps, lakeMessage, type MailboxState } from "./gmailCommon.ts";
import { arrayOrEmpty, text } from "./json.ts";
import { letterKey, messageKey } from "./keys.ts";
import type { TestResult } from "./model.ts";
import type { Walk } from "./paginate.ts";
import type { Connection, LakeRecord, LakeSummary, Run } from "./undercroft.ts";

export interface LakeContext {
  readonly connections: readonly Connection[];
  readonly runs: readonly Run[];
  readonly summary: LakeSummary;
}

async function identity(
  deps: GmailDeps,
  name: MailboxName,
  connection: Connection | undefined,
): Promise<{ ok: boolean; reason: string }> {
  const expected = deps.config.mailboxes[name].address.toLowerCase();
  try {
    const seen = (await deps.google[name].profile()).emailAddress.toLowerCase();
    const lakeSays = (connection?.externalAccountLabel ?? "").toLowerCase();
    const ok = seen === expected && lakeSays === expected;
    const reason = `token reads ${seen || "(nothing)"}, Undercroft source reads ${lakeSays || "(unknown)"}, config expects ${expected}`;
    return { ok, reason: ok ? "" : reason };
  } catch (error) {
    return { ok: false, reason: `profile unreadable: ${messageOf(error)}` };
  }
}

async function walkLake(
  deps: GmailDeps,
  source: string,
  summary: LakeSummary,
): Promise<{ lake: Walk<LakeRecord> | null; error: string | null }> {
  const declared = summary.records.find(
    (stream) => stream.source === source && stream.entity === "messages",
  )?.records;
  try {
    return { lake: await deps.undercroft.records(source, "messages", declared), error: null };
  } catch (error) {
    return { lake: null, error: messageOf(error) };
  }
}

export async function loadMailbox(
  deps: GmailDeps,
  name: MailboxName,
  context: LakeContext,
): Promise<MailboxState> {
  const source = deps.config.mailboxes[name].undercroftSource;
  const connection = context.connections.find((entry) => entry.source === source);
  const checked = await identity(deps, name, connection);
  const lastRead = context.runs.find(
    (run) =>
      run.source === source &&
      run.kind === "ingest" &&
      run.status === "ok" &&
      run.entities.includes("messages"),
  );
  const lastDocuments = context.runs.find(
    (run) =>
      run.source === source &&
      run.kind === "ingest" &&
      run.status === "ok" &&
      run.entities.includes("documents"),
  );
  const chosen = arrayOrEmpty(connection?.config.labels).map(text);
  const { labels, unmatched } = checked.ok
    ? await resolveLabels(deps, name, chosen)
    : { labels: chosen, unmatched: 0 };
  const { lake, error } = await walkLake(deps, source, context.summary);
  const byKey = new Map<string, LakeRecord[]>();
  for (const record of lake?.items ?? []) {
    const key = messageKey(name, record.sourceRecordId) ?? `${name}:?${record.sourceRecordId}`;
    byKey.set(key, [...(byKey.get(key) ?? []), record]);
  }
  return {
    name,
    source,
    identityOk: checked.ok,
    identityReason: checked.reason,
    labels,
    unmatchedLabels: unmatched,
    fileTypes: arrayOrEmpty(connection?.config.fileTypes).map(text),
    watermark: lastRead?.startedAt ?? null,
    documentsWatermark: lastDocuments?.startedAt ?? null,
    lake,
    lakeError: error,
    byKey,
  };
}

/**
 * The connection card names each chosen label as the customer sees it (`config.labels` is
 * `scope.labels.map(l => l.name)`), and a listing needs Gmail's id. A system label's name is its
 * id (`INBOX`); a user label's is not (`Label_12`). Each chosen label is matched by id first,
 * then by name, against the mailbox's own labels; one that matches neither -- renamed or deleted
 * since it was chosen -- is counted, never guessed.
 */
async function resolveLabels(
  deps: GmailDeps,
  name: MailboxName,
  chosen: readonly string[],
): Promise<{ labels: string[]; unmatched: number }> {
  const known = await deps.google[name].labels();
  const byId = new Set(known.map((label) => label.id));
  const byName = new Map(known.map((label) => [label.name, label.id] as const));
  const labels: string[] = [];
  let unmatched = 0;
  for (const label of chosen) {
    const id = byId.has(label) ? label : byName.get(label);
    if (id === undefined) {
      unmatched += 1;
    } else if (!labels.includes(id)) {
      labels.push(id);
    }
  }
  return { labels, unmatched };
}

export function identityCase(deps: GmailDeps, state: MailboxState): TestResult {
  const evidence = deps.sink.json(`GM-ID-${state.name}`, {
    mailbox: state.name,
    identityOk: state.identityOk,
    reason: state.identityReason,
  });
  return base(
    `GM-ID-001-${state.name}`,
    `The ${state.name} token reads the mailbox its lake source reads`,
    {
      requirement: "REQ-GM-01 source identity verified before comparison",
      contract: "CLAUDE.md connector identity guard; Undercroft connection externalAccountLabel",
      preconditions: "token file readable; Undercroft connection listed",
      expected: "Gmail profile address = configured address = Undercroft connection account",
      actual: state.identityOk ? "all three agree" : state.identityReason,
      status: state.identityOk ? "PASS" : "BLOCKED",
      reason: state.identityReason,
      evidence: [{ label: "identity", path: evidence }],
    },
  );
}

function walkVerdict(
  state: MailboxState,
  running: boolean,
): { status: TestResult["status"]; reason: string } {
  const walk = state.lake;
  if (walk === null) {
    return { status: "BLOCKED", reason: `lake unreadable: ${state.lakeError ?? ""}` };
  }
  if (!walk.exhausted) {
    return {
      status: "FAIL",
      reason: walk.loopDetected ? "lake cursor repeated" : "lake listing stopped before its end",
    };
  }
  if (walk.repeats.size > 0) {
    return {
      status: "FAIL",
      reason: `${walk.repeats.size} record id(s) delivered on more than one page`,
    };
  }
  const shortBy = walk.shortBy ?? 0;
  if (shortBy === 0) {
    return { status: "PASS", reason: "" };
  }
  const declared = walk.items.length + shortBy;
  const reason = `walk found ${walk.items.length}, lake summary declares ${declared}${running ? " while a run is landing" : ""}`;
  return { status: running ? "PENDING" : "FAIL", reason };
}

export function lakePagingCase(
  deps: GmailDeps,
  state: MailboxState,
  runs: readonly Run[],
): TestResult {
  const running = runs.some((run) => run.source === state.source && run.status === "running");
  const walk = state.lake;
  const facts =
    walk === null
      ? { error: state.lakeError }
      : {
          pages: walk.pages,
          items: walk.items.length,
          exhausted: walk.exhausted,
          loopDetected: walk.loopDetected,
          repeats: walk.repeats.size,
          shortBy: walk.shortBy,
          runInProgress: running,
        };
  const verdict = walkVerdict(state, running);
  return base(
    `GM-U-PAGE-001-${state.name}`,
    `The ${state.name} lake listing is read to its end, once`,
    {
      group: "integration",
      requirement: "REQ-GEN-01 pagination completeness",
      contract: "undercroft lake records: cursor paging, 50 per page; lake summary record count",
      preconditions: "Undercroft CLI reachable",
      expected: "exhausted, no repeated cursor, no id twice, count = lake summary",
      actual: JSON.stringify(facts),
      ...verdict,
      evidence: [{ label: "walk", path: deps.sink.json(`GM-U-PAGE-${state.name}`, facts) }],
    },
  );
}

/**
 * Issue #143: a Gmail id names a message in one mailbox. The lake keeps the two mailboxes in
 * separate sources, so an id present in both must be two messages -- and if they carried
 * different letters under one id, anything keying on the bare id would merge them.
 */
export function crossMailboxCase(
  deps: Pick<GmailDeps, "sink">,
  states: readonly MailboxState[],
): TestResult {
  const [first, second] = states;
  const common = {
    group: "regression" as const,
    requirement: "REQ-GM-03 message identity is mailbox-qualified",
    contract: "keys.messageKey = mailbox:gmailId",
    finding: "undercroft issue #143",
  };
  const title = "One Gmail id never names two different letters across mailboxes";
  if (first === undefined || second === undefined || first.lake === null || second.lake === null) {
    return base("GM-U-XMBX-001", title, {
      ...common,
      preconditions: "both lake sources readable",
      expected: "0 conflicting ids",
      actual: "not run",
      status: "BLOCKED",
      reason: "a lake source is unreadable",
      evidence: [],
    });
  }
  const other = new Map(
    second.lake.items.map((record) => [record.sourceRecordId, record] as const),
  );
  const shared = first.lake.items.filter((record) => other.has(record.sourceRecordId));
  const conflicts = shared.filter((record) => {
    const twin = other.get(record.sourceRecordId);
    return (
      twin !== undefined &&
      letterKey(lakeMessage(record).headers["Message-ID"]) !==
        letterKey(lakeMessage(twin).headers["Message-ID"])
    );
  });
  const evidence = deps.sink.rows(
    "GM-U-XMBX-001",
    conflicts.map((record) => ({ id: record.sourceRecordId })),
  );
  return base("GM-U-XMBX-001", title, {
    ...common,
    preconditions: "both lake sources read to the end",
    expected: "every id in both sources carries the same letter (or none are shared)",
    actual: `${shared.length} id(s) in both sources, ${conflicts.length} with different letters`,
    status: conflicts.length === 0 ? "PASS" : "FAIL",
    reason:
      conflicts.length === 0
        ? ""
        : `${conflicts.length} Gmail id(s) name different letters in the two mailboxes; a bare-id key would merge them`,
    evidence: [{ label: "conflicts", path: evidence }],
  });
}

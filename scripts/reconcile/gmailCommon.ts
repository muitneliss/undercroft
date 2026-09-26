/**
 * What the Gmail cases share: the mailbox state read once per run, the lake's and OSTWIN's
 * shape of a message, and the helpers that turn a leg's record verdicts into a test case.
 */

import type { ClientConfig, LiveConfig, MailboxName } from "./config.ts";
import type { EvidenceSink } from "./evidence.ts";
import type { GmailMessage } from "./gmail.ts";
import type { Unpublished } from "./gmailOstwin.ts";
import type { GoogleClient } from "./google.ts";
import { arrayOrEmpty, asObject, objectOrEmpty, text } from "./json.ts";
import {
  type FieldDiff,
  type Leg,
  legStatus,
  type RecordResult,
  type TestResult,
  tally,
} from "./model.ts";
import type { OstwinReader, Row } from "./ostwin.ts";
import type { Walk } from "./paginate.ts";
import type { LakeRecord, UndercroftReader } from "./undercroft.ts";

const SOURCE_RUN_TIME = /^(?<y>\d{4})(?<mo>\d{2})(?<d>\d{2})T(?<h>\d{2})(?<mi>\d{2})(?<s>\d{2})Z/u;
const WHITESPACE = /\s+/gu;

export interface GmailDeps {
  readonly config: LiveConfig;
  readonly ostwin: OstwinReader;
  readonly undercroft: UndercroftReader;
  readonly google: Readonly<Record<MailboxName, GoogleClient>>;
  readonly sink: EvidenceSink;
}

/** What the suite learned about one mailbox before comparing any client. */
export interface MailboxState {
  readonly name: MailboxName;
  readonly source: string;
  readonly identityOk: boolean;
  readonly identityReason: string;
  readonly labels: readonly string[];
  /** Start of Undercroft's last completed run that read messages; null when none is known. */
  readonly watermark: string | null;
  readonly lake: Walk<LakeRecord> | null;
  readonly lakeError: string | null;
  readonly byKey: ReadonlyMap<string, readonly LakeRecord[]>;
}

/** One message as the lake holds it, reduced to the fields the contract preserves. */
export interface LakeMessage {
  readonly threadId: string;
  readonly internalDate: string;
  readonly labelIds: readonly string[];
  readonly headers: Readonly<Record<string, string>>;
}

/** One message as OSTWIN's mart holds it (`gmail_message_evidence`). */
export interface OstwinMessage {
  readonly mailbox: string;
  readonly messageId: string;
  readonly threadId: string | null;
  readonly messageTime: string | null;
  readonly subject: string | null;
  readonly route: string | null;
  readonly labels: string | null;
  readonly rfc822MessageId: string | null;
  readonly sourceRun: string | null;
}

export type CaseFields = Omit<TestResult, "id" | "title" | "source" | "group"> & {
  group?: TestResult["group"];
};

export function base(id: string, title: string, fields: CaseFields): TestResult {
  return { id, title, source: "gmail", group: fields.group ?? "live", ...fields };
}

export function blocked(id: string, client: ClientConfig, leg: Leg, reason: string): TestResult {
  return base(id, `Gmail ${leg} for ${client.label}`, {
    leg,
    client: client.label,
    requirement: "REQ-GM-01 source identity verified before comparison",
    contract: "connector identity guard",
    preconditions: "mailbox identity verified; systems readable",
    expected: "comparison runs",
    actual: "not run",
    status: "BLOCKED",
    reason,
    evidence: [],
  });
}

export interface LegMeta {
  readonly id: string;
  readonly title: string;
  readonly leg: Leg;
  /** The client's CASE-ID; absent for a mailbox-wide leg. */
  readonly client?: string;
  readonly requirement: string;
  readonly contract: string;
  readonly preconditions: string;
  readonly expected: string;
  readonly actual: string;
}

/** A leg's record verdicts as a case: counts, status, and the non-matching records as evidence. */
export function legCase(
  deps: Pick<GmailDeps, "sink">,
  meta: LegMeta,
  records: readonly RecordResult[],
  synchronised: boolean,
): TestResult {
  const counts = tally(records);
  const verdict = legStatus(counts, synchronised);
  deps.sink.judged?.(meta.id, records);
  const evidence = deps.sink.rows(
    meta.id,
    records.filter((record) => record.verdict !== "MATCH"),
  );
  return base(meta.id, meta.title, {
    leg: meta.leg,
    ...(meta.client === undefined ? {} : { client: meta.client }),
    requirement: meta.requirement,
    contract: meta.contract,
    preconditions: meta.preconditions,
    expected: meta.expected,
    actual: meta.actual,
    status: verdict.status,
    reason: verdict.reason,
    counts,
    evidence: [{ label: "non-matching records", path: evidence }],
  });
}

export function lakeMessage(record: LakeRecord): LakeMessage {
  const payload = asObject(record.payload);
  const headers = objectOrEmpty(payload.headers);
  return {
    threadId: text(payload.threadId),
    internalDate: text(payload.internalDate),
    labelIds: arrayOrEmpty(payload.labelIds).map(text),
    headers: Object.fromEntries(
      Object.entries(headers).map(([name, value]) => [name, text(value)]),
    ),
  };
}

export function pushDiff(
  diffs: FieldDiff[],
  field: string,
  expected: string | null | undefined,
  actual: string | null | undefined,
): void {
  const left = expected ?? "";
  const right = actual ?? "";
  if (left !== right) {
    diffs.push({ field, expected: left, actual: right });
  }
}

export function squash(value: string | null | undefined): string {
  return (value ?? "").replace(WHITESPACE, " ").trim();
}

/** `20260914T143157Z-…` -> epoch ms; null when the run id carries no time. */
export function sourceRunTime(sourceRun: string | null): number | null {
  const groups = SOURCE_RUN_TIME.exec(sourceRun ?? "")?.groups;
  if (groups === undefined) {
    return null;
  }
  return Date.parse(`${groups.y}-${groups.mo}-${groups.d}T${groups.h}:${groups.mi}:${groups.s}Z`);
}

/** Before-or-at a watermark; an unknown watermark or time is never "synced". */
export function atOrBefore(epochMs: number, watermark: string | number | null): boolean {
  if (watermark === null || Number.isNaN(epochMs)) {
    return false;
  }
  const mark = typeof watermark === "number" ? watermark : Date.parse(watermark);
  return epochMs <= mark;
}

/** Everything one client's legs in one mailbox compare. */
export interface MailboxRead {
  readonly state: MailboxState;
  /** Message key -> the OSTWIN routes whose query found it in Gmail now. */
  readonly found: ReadonlyMap<string, ReadonlySet<string>>;
  readonly listingComplete: boolean;
  /** Message key -> Gmail's metadata now; null when Gmail no longer has it. */
  readonly source: ReadonlyMap<string, GmailMessage | null>;
  readonly ostwin: ReadonlyMap<string, OstwinMessage>;
  readonly discarded: ReadonlyMap<string, string>;
  readonly harvest: Row | undefined;
  readonly unpublished: Unpublished;
}

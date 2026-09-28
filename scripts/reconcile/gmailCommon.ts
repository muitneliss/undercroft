/**
 * What the Gmail cases share: the mailbox state read once per run, the lake's shape of a
 * message, and the helpers that turn a leg's record verdicts into a test case.
 */

import type { LiveConfig, MailboxName } from "./config.ts";
import type { EvidenceSink } from "./evidence.ts";
import type { FullMessage } from "./gmail.ts";
import type { GoogleClient } from "./google.ts";
import { arrayOrEmpty, asObject, objectOrEmpty, text } from "./json.ts";
import { type Leg, legStatus, type RecordResult, type TestResult, tally } from "./model.ts";
import type { Walk } from "./paginate.ts";
import type { LakeRecord, UndercroftReader } from "./undercroft.ts";

export interface GmailDeps {
  readonly config: LiveConfig;
  readonly undercroft: UndercroftReader;
  readonly google: Readonly<Record<MailboxName, GoogleClient>>;
  readonly sink: EvidenceSink;
  /** A line of progress for a long read; the live run writes it to stderr. */
  readonly progress?: (line: string) => void;
  /**
   * Messages already read from Gmail in this working session, so a run that has to be repeated
   * does not spend the mailbox's quota again. A message never changes but its labels; a cached
   * read's labels are as old as the cache, and the live run records that age.
   */
  readonly sourceCache?: SourceCache;
  /** Minimum spacing between Gmail message reads, per mailbox; the live run's default is 330 ms. */
  readonly readSpacingMs?: number;
}

export interface SourceCache {
  /** The cached read (null = Gmail answered 404), or undefined when never read. */
  get: (key: string) => FullMessage | null | undefined;
  put: (key: string, message: FullMessage | null) => void;
}

/** What the suite learned about one mailbox before comparing anything. */
export interface MailboxState {
  readonly name: MailboxName;
  readonly source: string;
  readonly identityOk: boolean;
  readonly identityReason: string;
  /** The chosen labels as Gmail ids, resolved from the names the connection card shows. */
  readonly labels: readonly string[];
  /** Chosen labels no Gmail label matches by id or name; any makes the scope unlistable. */
  readonly unmatchedLabels: number;
  /** The attachment types the connection lands (`config.fileTypes`); empty means every type. */
  readonly fileTypes: readonly string[];
  /** Start of Undercroft's last completed run that read messages; null when none is known. */
  readonly watermark: string | null;
  /** Start of Undercroft's last completed run that landed documents; null when none is known. */
  readonly documentsWatermark: string | null;
  readonly lake: Walk<LakeRecord> | null;
  readonly lakeError: string | null;
  readonly byKey: ReadonlyMap<string, readonly LakeRecord[]>;
}

/** One message as the lake holds it, reduced to the fields the contract preserves. */
export interface LakeMessage {
  /** The payload's own `id`, which must be the record's source id. */
  readonly id: string;
  readonly threadId: string;
  readonly internalDate: string;
  readonly labelIds: readonly string[];
  readonly headers: Readonly<Record<string, string>>;
}

export type CaseFields = Omit<TestResult, "id" | "title" | "source" | "group"> & {
  group?: TestResult["group"];
};

export function base(id: string, title: string, fields: CaseFields): TestResult {
  return { id, title, source: "gmail", group: fields.group ?? "live", ...fields };
}

export interface LegMeta {
  readonly id: string;
  readonly title: string;
  readonly leg: Leg;
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
    id: text(payload.id),
    threadId: text(payload.threadId),
    internalDate: text(payload.internalDate),
    labelIds: arrayOrEmpty(payload.labelIds).map(text),
    headers: Object.fromEntries(
      Object.entries(headers).map(([name, value]) => [name, text(value)]),
    ),
  };
}

/** Before-or-at a watermark; an unknown watermark or time is never "synced". */
export function atOrBefore(epochMs: number, watermark: string | number | null): boolean {
  if (watermark === null || Number.isNaN(epochMs)) {
    return false;
  }
  const mark = typeof watermark === "number" ? watermark : Date.parse(watermark);
  return epochMs <= mark;
}

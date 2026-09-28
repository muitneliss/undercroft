/**
 * Every attachment the connector must store, against the lake's documents for the mailbox.
 *
 * WHAT THE CONNECTOR PROMISES (worker `google/gmail.ts`, v1.43.0): for each message it reads,
 * every part walked depth-first -- numbered from 1 in visiting order, the payload itself not
 * counted -- that carries an `attachmentId` and whose type the connection's `fileTypes` allow
 * (`allowsFile`, the published matching rule) lands as one document with id
 * `<gmailId>:<part index, three digits>`, catalogued under `landedType`, declared at the part's
 * `body.size`. The same file attached to two letters is two documents; equal bytes are not a
 * duplicate. The expected set is computed here from Gmail, not read from the lake.
 *
 * ABSENCE IS NOT MISSING HERE EITHER. A held message is never read again, so its documents
 * were decided by the `fileTypes` of the run that first read it -- which Undercroft does not
 * record. An absent document is NOT_YET_SYNCED when its message is newer than the last
 * completed run that landed documents, and BLOCKED otherwise. A lake document is retained
 * history when its message left the mailbox or the label selection, BLOCKED when its part is an
 * attachment of a type the current `fileTypes` leave out, and EXTRA only when the message is
 * still there and part of that number is not an attachment at all: a Gmail message never
 * changes, so no run could ever have read one there.
 */

import { allowsFile, landedType } from "../../packages/contracts/src/fileMatching.ts";
import { reconcileLeg } from "./classify.ts";
import type { MessagePart } from "./gmail.ts";
import { atOrBefore, base, type GmailDeps, legCase, type MailboxState } from "./gmailCommon.ts";
import { RETAINED } from "./gmailCompleteness.ts";
import type { SourceRead } from "./gmailSource.ts";
import type { FieldDiff, RecordResult, TestResult } from "./model.ts";
import type { Walk } from "./paginate.ts";
import type { LakeDocument } from "./undercroft.ts";

const INDEX = /:(?<index>\d{3})$/u;
/**
 * The connector refuses, before fetching, an attachment whose declared size is over 25 MiB
 * (worker `landDocument.ts`, `MAX_DOCUMENT_BYTES`): a rule of its contract, not a loss.
 */
const MAX_DOCUMENT_BYTES = 25n * 1024n * 1024n;
const DIGITS = /^\d+$/u;

/** One attachment Gmail says the connector must store. */
export interface ExpectedDocument {
  readonly messageKey: string;
  readonly contentType: string;
  readonly bytes: string;
}

export function documentKey(messageKey: string, index: number): string {
  return `${messageKey}:${String(index).padStart(3, "0")}`;
}

/** The message key a document key belongs to, and the part index it names. */
export function splitDocumentKey(key: string): { messageKey: string; index: number } | null {
  const match = INDEX.exec(key);
  const index = match?.groups?.index;
  if (match === null || index === undefined) {
    return null;
  }
  return { messageKey: key.slice(0, match.index), index: Number.parseInt(index, 10) };
}

function allowed(fileTypes: readonly string[], part: MessagePart): boolean {
  return (
    part.hasAttachmentId && allowsFile(fileTypes, { mimeType: part.mimeType, name: part.filename })
  );
}

/** Every attachment of every listed message the connection's file types allow. */
export function expectedDocuments(
  state: MailboxState,
  read: SourceRead,
): Map<string, ExpectedDocument> {
  const expected = new Map<string, ExpectedDocument>();
  for (const key of read.listed.keys()) {
    const message = read.messages.get(key);
    if (message === null || message === undefined) {
      continue;
    }
    for (const part of message.parts) {
      if (allowed(state.fileTypes, part)) {
        expected.set(documentKey(key, part.index), {
          messageKey: key,
          contentType: landedType({ mimeType: part.mimeType, name: part.filename }),
          bytes: part.size,
        });
      }
    }
  }
  return expected;
}

function judgeLakeOnlyDocument(
  read: SourceRead,
  key: string,
): { verdict: RecordResult["verdict"]; reason: string } {
  const split = splitDocumentKey(key);
  if (split === null) {
    return { verdict: "BLOCKED", reason: "document id does not name a message part" };
  }
  if (read.unreadable.has(split.messageKey) || !read.messages.has(split.messageKey)) {
    return { verdict: "BLOCKED", reason: "the document's message could not be read from Gmail" };
  }
  const message = read.messages.get(split.messageKey) ?? null;
  if (message === null) {
    return {
      verdict: "OUT_OF_SCOPE",
      reason: `${RETAINED}: its message was deleted from the mailbox; nothing is tombstoned`,
    };
  }
  if (!read.listed.has(split.messageKey)) {
    return {
      verdict: "OUT_OF_SCOPE",
      reason: `${RETAINED}: its message left the label selection since it landed`,
    };
  }
  const part = message.parts.find((candidate) => candidate.index === split.index);
  if (part === undefined || !part.hasAttachmentId) {
    return {
      verdict: "EXTRA",
      reason:
        "its message is still in the mailbox and a message never changes, but that part number is not an attachment in it",
    };
  }
  return {
    verdict: "BLOCKED",
    reason:
      "extra_unresolved: an attachment of a type the current fileTypes leave out; Undercroft keeps no history of fileTypes",
  };
}

function compareDocument(expected: ExpectedDocument, lake: LakeDocument): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  if (expected.contentType !== lake.contentType) {
    diffs.push({ field: "contentType", expected: expected.contentType, actual: lake.contentType });
  }
  if (expected.bytes !== String(lake.bytes)) {
    diffs.push({ field: "bytes", expected: expected.bytes, actual: String(lake.bytes) });
  }
  return diffs;
}

function walkBlocker(walk: Walk<LakeDocument> | null, error: string | null): string | null {
  if (walk === null) {
    return `lake documents unreadable: ${error ?? ""}`;
  }
  if (!walk.exhausted || walk.repeats.size > 0 || (walk.shortBy ?? 0) !== 0) {
    return `lake documents not read to the end (exhausted ${walk.exhausted}, repeats ${walk.repeats.size}, short by ${walk.shortBy ?? "?"})`;
  }
  return null;
}

/**
 * Expected attachments by the type they land under: how many the lake holds and how many are
 * absent. A type absent in full while the lake holds others is the shape of a matching rule the
 * mailbox's held messages were never re-read under.
 */
function byType(
  expected: ReadonlyMap<string, ExpectedDocument>,
  records: readonly RecordResult[],
): { heldByType: Record<string, number>; absentByType: Record<string, number> } {
  const verdicts = new Map(records.map((record) => [record.key, record.verdict] as const));
  const held: Record<string, number> = {};
  const absent: Record<string, number> = {};
  for (const [key, document] of expected) {
    const verdict = verdicts.get(key);
    const bucket =
      verdict === "BLOCKED" || verdict === "NOT_YET_SYNCED" || verdict === "MISSING"
        ? absent
        : held;
    bucket[document.contentType] = (bucket[document.contentType] ?? 0) + 1;
  }
  return { heldByType: held, absentByType: absent };
}

const DOC_LEG = {
  requirement: "REQ-GM-04 Undercroft stores every attachment its file types allow",
  contract:
    "Undercroft gmail connector v1.43.0: depth-first part index, attachmentId required, allowsFile(fileTypes), landedType, documentId <gmailId>:<index>",
};

/** Every expected attachment against every lake document of the mailbox. */
function judgeDocuments(
  state: MailboxState,
  read: SourceRead,
  walk: Walk<LakeDocument>,
): { expected: Map<string, ExpectedDocument>; records: RecordResult[] } {
  const expected = expectedDocuments(state, read);
  const records = reconcileLeg<ExpectedDocument, LakeDocument>({
    reference: [...expected.entries()].map(([key, record]) => ({
      key,
      record,
      evidence: `gmail:${record.messageKey} format=full`,
    })),
    target: walk.items.map((document) => ({
      key: `${state.name}:${document.documentId}`,
      record: document,
      evidence: `lake:${document.source}/documents/${document.documentId} run=${document.runId} sha=${document.sha256}`,
    })),
    inScope: () => ({ inScope: true, reason: "" }),
    excludedBy: (_key, record) =>
      DIGITS.test(record.bytes) && BigInt(record.bytes) > MAX_DOCUMENT_BYTES
        ? "declared size over the 25 MiB ceiling the connector refuses before fetching"
        : null,
    synced: (record) =>
      atOrBefore(
        Number.parseInt(read.messages.get(record.messageKey)?.internalDate ?? "", 10),
        state.documentsWatermark,
      ),
    undecided: (_key, record) =>
      state.byKey.has(record.messageKey)
        ? "its message is held, but a held message is not read again and Undercroft keeps no record of the fileTypes the run that first read it allowed"
        : "neither the attachment nor its message is held, and Undercroft keeps no record of the label selection or fileTypes each run read",
    compare: compareDocument,
    judgeExtra: (key) => judgeLakeOnlyDocument(read, key),
  });
  return { expected, records };
}

/** What the attachments leg needs: the mailbox read, the lake's documents, and any blocker. */
export interface AttachmentsInput {
  readonly read: SourceRead | null;
  readonly documents: { walk: Walk<LakeDocument> | null; error: string | null };
  readonly blocker: string | null;
}

export function attachmentsCase(
  deps: Pick<GmailDeps, "sink">,
  state: MailboxState,
  { read, documents, blocker }: AttachmentsInput,
): TestResult {
  const id = `GM-S2U-DOC-001-${state.name}`;
  const title = `Every ${state.name} attachment the connection's file types allow is stored in the lake`;
  const why =
    blocker ??
    (read === null ? "the mailbox was not read" : walkBlocker(documents.walk, documents.error));
  if (why !== null || read === null || documents.walk === null) {
    return base(id, title, {
      leg: "S2U",
      ...DOC_LEG,
      preconditions: "identity verified; lake documents read to the end; messages read",
      expected: "no MISSING / DUPLICATE / EXTRA / CONTENT_MISMATCH",
      actual: "not run",
      status: "BLOCKED",
      reason: why ?? "not run",
      evidence: [],
    });
  }
  const { expected, records } = judgeDocuments(state, read, documents.walk);
  const lake = documents.walk.items.length;
  const retained = records.filter((record) => record.reason.startsWith(RETAINED)).length;
  const facts = deps.sink.json(`${id}-facts`, {
    fileTypes: state.fileTypes,
    expected: expected.size,
    ...byType(expected, records),
    lake,
    retainedByPolicy: retained,
    documentsWatermark: state.documentsWatermark,
    readComplete: { source: read.complete ? "exact_total" : "no", target: "cursor" },
  });
  const result = legCase(
    deps,
    {
      id,
      title,
      leg: "S2U",
      ...DOC_LEG,
      preconditions: `messages read; Undercroft documents watermark ${state.documentsWatermark ?? "unknown"}`,
      expected: "every allowed attachment stored once, same type and size",
      actual: `expected ${expected.size}, lake ${lake}, retained by policy ${retained}`,
    },
    records,
    read.complete && state.documentsWatermark !== null,
  );
  return { ...result, evidence: [...result.evidence, { label: "document facts", path: facts }] };
}

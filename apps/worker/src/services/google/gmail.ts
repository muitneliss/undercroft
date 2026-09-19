/**
 * Gmail: message headers into `raw.records`, PDF attachments into the lake.
 *
 * What is promised on the consent card is what this reads and no more: "message headers and
 * PDF attachments from the mailbox you connect", scoped to chosen labels or deliberately to
 * the whole mailbox. Bodies are never fetched.
 *
 * TWO THINGS HERE ARE EASY TO GET WRONG AND EXPENSIVE TO GET WRONG.
 *
 * **`labelIds` is AND, not OR.** One query carrying three label ids returns only the
 * messages that hold all three, which for most selections is none. A single query looks
 * right, passes a test written from the same misunderstanding, and silently ingests nothing
 * for every tenant that picked more than one label. So there is one paged query per selected
 * label, unioned by message id.
 *
 * **`attachmentId` is not stable.** It is scoped to one message read and changes between
 * fetches, so keying a document on it re-lands the same PDF under a new key every run --
 * unbounded storage growth that looks like legitimate history. The stable identity is
 * `(messageId, partIndex)`.
 *
 * Headers are extracted rather than stored whole: the body of a message is not ours to
 * keep, and `format=metadata` is what the consent says we ask for.
 */

import { canonicalJson, decodeBase64Url, getPath, getStringPath } from "@undercroft/core";
import type { GmailScope } from "@undercroft/contracts";

import type { DocumentToLand } from "../landDocument.ts";
import type { RecordToLand } from "../land.ts";
import { type RunJournal, SILENT_JOURNAL } from "../runJournal.ts";
import type { GoogleApi } from "./api.ts";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const PDF = "application/pdf";
const ENTITY = "messages";
/** Page size. Gmail caps at 500; 100 keeps a page's follow-up fetches bounded. */
const PAGE_SIZE = "100";
/** Enough to identify and reconcile a message; deliberately not the body. */
const HEADERS = ["From", "To", "Cc", "Subject", "Date", "Message-ID"] as const;

export interface GmailHarvest {
  readonly records: RecordToLand[];
  readonly documents: DocumentToLand[];
}

export function gmailBaseUrl(): string {
  return GMAIL_BASE;
}

/** One row of the label listing, as the scope picker needs to see it. */
export interface GmailLabel {
  readonly id: string;
  readonly name: string;
  /** Gmail's own `type`, or null where it did not say. See `labelKind`. */
  readonly kind: "system" | "user" | null;
}

/** The labels an admin can choose from. Needs a live token, so it runs in the worker. */
export async function listLabels(api: GoogleApi): Promise<GmailLabel[]> {
  const body = await api.getJson(`${GMAIL_BASE}/labels`, "labels");
  const labels = asArray(getPath(body, "labels"));
  return labels.flatMap((label) => {
    const id = str(label, "id");
    if (id === "") {
      return [];
    }
    const name = str(label, "name");
    return [{ id, name: name === "" ? id : name, kind: labelKind(str(label, "type")) }];
  });
}

/**
 * Gmail's ownership of a label, kept three-valued.
 *
 * The picker sets an admin's own labels ahead of the thirteen Gmail ships, because in a real
 * mailbox the built-ins are the noise that the labels they came to find are buried under.
 * That ordering is only worth having if it is TRUE, so a label Gmail did not classify stays
 * unclassified rather than being filed under the commoner of the two answers.
 */
function labelKind(reported: string): "system" | "user" | null {
  return reported === "system" || reported === "user" ? reported : null;
}

/**
 * Harvest a mailbox under a chosen scope.
 *
 * Returns what to land rather than landing it, so the decision of what a mailbox contains
 * is testable without a lake or a database.
 */
export async function harvestGmail(
  api: GoogleApi,
  scope: GmailScope,
  journal: RunJournal = SILENT_JOURNAL,
): Promise<GmailHarvest> {
  const selected = new Set(scope.labels.map((l) => l.id));
  const messageIds = await listMessageIds(api, scope);

  const records: RecordToLand[] = [];
  const documents: DocumentToLand[] = [];

  // The most useful line this run writes. What follows is one paced request per message --
  // minutes for a real mailbox -- and until now the first sign of how long that would take
  // was the run ending. A total up front turns a blank screen into a quantity.
  journal.info("work_listed", { entity: ENTITY, total: messageIds.length });

  for (const messageId of messageIds) {
    journal.progress("records_read", {
      entity: ENTITY,
      read: records.length,
      total: messageIds.length,
    });
    const message = await api.getJson(messageUrl(messageId), ENTITY, records.length);
    const labelIds = strings(getPath(message, "labelIds"));

    // Defence in depth: the query said what to fetch, this says what may be kept. A label
    // removed between the listing and the fetch, or a query built wrong, must not widen
    // what we store beyond what the admin agreed to.
    if (selected.size > 0 && !labelIds.some((id) => selected.has(id))) {
      continue;
    }

    const headers = headerMap(message);
    const internalDate = str(message, "internalDate");
    records.push(messageRecord(messageId, message, labelIds, internalDate));
    for (const part of pdfParts(message)) {
      documents.push(attachment(api, { messageId, headers, labelIds, internalDate }, part));
    }
  }

  return { records, documents };
}

/**
 * One message as a record to land.
 *
 * Built from extracted fields, then canonicalised -- never re-serialised from a parsed
 * payload, and carrying no plain JS number (`canonicalJson` refuses one, and an id that had
 * been through a float would be a different id).
 */
function messageRecord(
  messageId: string,
  message: unknown,
  labelIds: string[],
  internalDate: string,
): RecordToLand {
  return {
    entity: ENTITY,
    sourceRecordId: messageId,
    sourceUpdatedAt: isoFromEpochMillis(internalDate),
    payloadText: canonicalJson({
      id: messageId,
      threadId: str(message, "threadId"),
      labelIds,
      headers: headerMap(message),
      snippetOmitted: true,
      internalDate,
    }),
  };
}

/** What a message says about itself that its attachments need. */
interface MessageFacts {
  readonly messageId: string;
  readonly headers: Record<string, string>;
  readonly labelIds: string[];
  readonly internalDate: string;
}

/**
 * One PDF attachment as a document to land.
 *
 * The split between `metadata` and `manifest` is the whole point and it is load-bearing:
 * `metadata` reaches `raw.documents`, which dbt and BI can read, so it carries opaque ids,
 * enumerations and counts only. Every name a human wrote goes in `manifest`, which lives in
 * the access-controlled object store. `pii.md`, ADR 0015.
 */
function attachment(api: GoogleApi, facts: MessageFacts, part: PdfPart): DocumentToLand {
  const { messageId, headers, labelIds, internalDate } = facts;
  const { attachmentId } = part;

  return {
    // (messageId, partIndex), never attachmentId. See the module docstring.
    documentId: `${messageId}:${String(part.index).padStart(3, "0")}`,
    contentType: PDF,
    declaredBytes: part.size,
    metadata: { labelIds, partIndex: String(part.index), messageId },
    manifest: {
      filename: part.filename,
      subject: headers.Subject ?? "",
      from: headers.From ?? "",
      to: headers.To ?? "",
      messageId,
    },
    sourceUpdatedAt: isoFromEpochMillis(internalDate),
    fetchBytes: async (): Promise<Uint8Array> => {
      const body = await api.getJson(
        `${GMAIL_BASE}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
        "attachments",
        0,
      );
      return decodeBase64Url(str(body, "data"));
    },
  };
}

/**
 * One paged query per selected label, unioned.
 *
 * A `Set` rather than a list because a message carrying two selected labels is one message.
 * With nothing selected this is a single unfiltered query -- the whole mailbox, which is a
 * decision the admin recorded rather than an absent one.
 */
async function listMessageIds(api: GoogleApi, scope: GmailScope): Promise<string[]> {
  const queries = scope.labels.length === 0 ? [null] : scope.labels.map((label) => label.id);
  const ids = new Set<string>();

  for (const labelId of queries) {
    await collectLabelIds(api, labelId, ids);
  }

  return [...ids];
}

/** The URL of one page of message ids: the label, if any, and the cursor, if any. */
function listUrl(labelId: string | null, pageToken: string | null): string {
  const url = new URL(`${GMAIL_BASE}/messages`);
  url.searchParams.set("maxResults", PAGE_SIZE);
  if (labelId !== null) {
    url.searchParams.set("labelIds", labelId);
  }
  if (pageToken !== null) {
    url.searchParams.set("pageToken", pageToken);
  }
  return url.toString();
}

/**
 * Every message id under one label, page by page, added to the union.
 *
 * Sequential because each page's cursor comes out of the one before it -- there is nothing to
 * parallelise, and Gmail's pacing is per request either way.
 */
async function collectLabelIds(
  api: GoogleApi,
  labelId: string | null,
  ids: Set<string>,
): Promise<void> {
  let pageToken: string | null = null;
  do {
    const page = await api.getJson(listUrl(labelId, pageToken), ENTITY, ids.size);
    for (const message of asArray(getPath(page, "messages"))) {
      const id = str(message, "id");
      if (id !== "") {
        ids.add(id);
      }
    }
    const next = str(page, "nextPageToken");
    pageToken = next === "" ? null : next;
  } while (pageToken !== null);
}

function messageUrl(messageId: string): string {
  const url = new URL(`${GMAIL_BASE}/messages/${encodeURIComponent(messageId)}`);
  url.searchParams.set("format", "metadata");
  for (const header of HEADERS) {
    url.searchParams.append("metadataHeaders", header);
  }
  return url.toString();
}

interface PdfPart {
  readonly index: number;
  readonly attachmentId: string;
  readonly filename: string;
  readonly size: string;
}

/**
 * Every PDF attachment in a message, walked depth-first.
 *
 * Recursive because a forwarded mail nests `parts` inside `parts`, and an attachment two
 * levels down is still an attachment. The index counts every part visited, so it is stable
 * for a given message shape -- which is what makes it usable as half of the document id.
 */
function pdfParts(message: unknown): PdfPart[] {
  const found: PdfPart[] = [];
  let index = 0;

  function walk(part: unknown): void {
    index += 1;
    const mimeType = str(part, "mimeType");
    const attachmentId = str(part, "body.attachmentId");
    const filename = str(part, "filename");
    if (mimeType === PDF && attachmentId !== "") {
      found.push({
        index,
        attachmentId,
        filename,
        size: str(part, "body.size") || "0",
      });
    }
    for (const child of asArray(getPath(part, "parts"))) {
      walk(child);
    }
  }

  for (const part of asArray(getPath(message, "payload.parts"))) {
    walk(part);
  }
  return found;
}

function headerMap(message: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const header of asArray(getPath(message, "payload.headers"))) {
    const name = str(header, "name");
    if (name !== "") {
      out[name] = str(header, "value");
    }
  }
  return out;
}

/**
 * Gmail's `internalDate` is epoch milliseconds as a string.
 *
 * Unreadable is `null`, never a guess and never `0` -- an epoch-zero timestamp downstream
 * is indistinguishable from a real 1970 date, and a wrong value is worse than a missing one.
 */
const EPOCH_MILLIS = /^\d+$/u;

function isoFromEpochMillis(value: string): string | null {
  if (!EPOCH_MILLIS.test(value)) {
    return null;
  }
  // parseInt, not Number(): the money rule bans Number() repo-wide, and this is an
  // epoch-millis count rather than an amount. Same reasoning as core's fetcher.
  const date = new Date(Number.parseInt(value, 10));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * A string at a dotted path, or `""`.
 *
 * Through `getStringPath` rather than `String(...)`: a losslessly parsed number is an
 * object, and coercing it is how an exact id becomes "[object Object]". Core already solved
 * this for the connector runtime and the answer is the same here.
 */
function str(root: unknown, path: string): string {
  return getStringPath(root, path) ?? "";
}

/**
 * The string elements of an array, skipping anything else.
 *
 * Gmail sends label ids as strings. Something that is not a string is not an id we can use,
 * and skipping it is honest where coercing it would invent one.
 */
function strings(value: unknown): string[] {
  return asArray(value).filter((v): v is string => typeof v === "string");
}

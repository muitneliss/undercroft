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
import type { GoogleApi } from "./api.ts";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const PDF = "application/pdf";
const ENTITY = "messages";
/** Page size. Gmail caps at 500; 100 keeps a page's follow-up fetches bounded. */
const PAGE_SIZE = "100";
/** Gmail's `internalDate`, which is epoch millis as text. Anything else is unreadable. */
const DIGITS_ONLY = /^\d+$/u;
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
export async function harvestGmail(api: GoogleApi, scope: GmailScope): Promise<GmailHarvest> {
  const selected = new Set(scope.labels.map((l) => l.id));
  const messageIds = await listMessageIds(api, scope);

  const records: RecordToLand[] = [];
  const documents: DocumentToLand[] = [];

  for (const messageId of messageIds) {
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
    records.push({
      entity: ENTITY,
      sourceRecordId: messageId,
      sourceUpdatedAt: isoFromEpochMillis(internalDate),
      // Built from extracted fields, then canonicalised -- never re-serialised from a
      // parsed payload, and carrying no plain JS number (`canonicalJson` refuses one, and
      // an id that had been through a float would be a different id).
      payloadText: canonicalJson({
        id: messageId,
        threadId: str(message, "threadId"),
        labelIds,
        headers,
        snippetOmitted: true,
        internalDate,
      }),
    });

    for (const part of pdfParts(message)) {
      const attachmentId = part.attachmentId;
      documents.push({
        // (messageId, partIndex), never attachmentId. See the module docstring.
        documentId: `${messageId}:${String(part.index).padStart(3, "0")}`,
        contentType: PDF,
        declaredBytes: part.size,
        // Opaque ids, enumerations and counts only -- this reaches dbt.
        metadata: {
          labelIds,
          partIndex: String(part.index),
          messageId,
        },
        // Names a human wrote. The lake manifest, which dbt and BI cannot reach.
        manifest: {
          filename: part.filename,
          subject: headers.Subject ?? "",
          from: headers.From ?? "",
          to: headers.To ?? "",
          messageId,
        },
        sourceUpdatedAt: isoFromEpochMillis(internalDate),
        fetchBytes: async () => {
          const body = await api.getJson(
            `${GMAIL_BASE}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
            "attachments",
            records.length,
          );
          return decodeBase64Url(str(body, "data"));
        },
      });
    }
  }

  return { records, documents };
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
    let pageToken: string | null = null;
    do {
      const url = new URL(`${GMAIL_BASE}/messages`);
      url.searchParams.set("maxResults", PAGE_SIZE);
      if (labelId !== null) {
        url.searchParams.set("labelIds", labelId);
      }
      if (pageToken !== null) {
        url.searchParams.set("pageToken", pageToken);
      }

      const page = await api.getJson(url.toString(), ENTITY, ids.size);
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

  return [...ids];
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
function isoFromEpochMillis(value: string): string | null {
  if (!DIGITS_ONLY.test(value)) {
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

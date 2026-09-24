/**
 * Gmail: message headers into `raw.records`, matching attachments into the lake.
 *
 * What is promised on the consent card is what this reads and no more: "message headers and
 * the attachment types you allow, from the mailbox you connect", scoped to chosen labels or
 * deliberately to the whole mailbox. Bodies are never fetched.
 *
 * FOUR THINGS HERE ARE EASY TO GET WRONG AND EXPENSIVE TO GET WRONG.
 *
 * **`format` decides whether attachments exist at all.** `metadata` returns "only email
 * message ID, labels, and email headers" -- Google's own words -- which means no
 * `payload.parts` and so no `body.attachmentId`. A collector that asks for it walks an empty
 * parts list and lands every message with none of its attachments, looking for all the world
 * like a mailbox that has none. Only `format=full` carries them. This module asked for
 * `metadata` until the fix that added this paragraph, and the suite agreed with it because
 * the fixture answered a metadata request with parts -- an API that does not exist.
 *
 * **`labelIds` is AND, not OR.** One query carrying three label ids returns only the
 * messages that hold all three, which for most selections is none. A single query looks
 * right, passes a test written from the same misunderstanding, and silently ingests nothing
 * for every tenant that picked more than one label. So there is one paged query per selected
 * label, unioned by message id.
 *
 * **`attachmentId` is not stable.** It is scoped to one message read and changes between
 * fetches, so keying a document on it re-lands the same attachment under a new key every run
 * -- unbounded storage growth that looks like legitimate history. The stable identity is
 * `(messageId, partIndex)`.
 *
 * **Which types are allowed is `scope.fileTypes`, checked client-side.** Gmail's API has no
 * request-level filter on an attachment's MIME type -- only `labelIds` narrows what is fetched
 * at all -- so every part of every fetched message is walked and matched here. Empty means
 * every type, the same recorded-decision idiom `@undercroft/contracts` uses for an empty
 * label or entity list.
 *
 * Headers are extracted rather than stored whole, and that is now the ONLY thing keeping a
 * body out of the lake: `format=full` returns bodies and every header, where `format=metadata`
 * returned neither. Nothing here reads `body.data` or `snippet`, `headerMap` keeps the six
 * headers the consent names, and `messageRecord` builds its payload from extracted fields
 * rather than the response -- so what is fetched is wider than before while what is STORED is
 * byte-for-byte what it was. Both halves are pinned by tests; neither is safe to relax.
 */

import { allowsFile, type GmailScope, landedType } from "@undercroft/contracts";
import { canonicalJson, decodeBase64Url, getPath, getStringPath } from "@undercroft/core";

import type { DocumentToLand } from "../landDocument.ts";
import type { RecordToLand } from "../land.ts";
import type { RunJournal } from "../runJournal.ts";
import type { GoogleApi } from "./api.ts";
import type { AlreadyHeld, Harvest } from "./harvest.ts";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const ENTITY = "messages";
/** Page size. Gmail caps at 500; 100 keeps a page's follow-up fetches bounded. */
const PAGE_SIZE = "100";
/** Enough to identify and reconcile a message; deliberately not the body. */
const HEADERS = ["From", "To", "Cc", "Subject", "Date", "Message-ID"] as const;

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
 * Harvest a mailbox under a chosen scope, one message at a time.
 *
 * Yields what to land rather than landing it, so the decision of what a mailbox contains is
 * testable without a lake or a database -- and yields rather than returns, so the decision
 * costs one message rather than the whole mailbox. Buffering it was what put 7,786 messages
 * in a 1 GiB container and got the process oom-killed 76 minutes in.
 *
 * **A MESSAGE WE ALREADY HOLD, COMPLETE, IS NOT FETCHED AT ALL.** Listing ids is one request
 * per hundred; reading a message is one paced request each, at 334ms, so a 7,786-message
 * mailbox is 43 minutes of `messages.get` and nothing else. The test is a row in
 * `raw.records` that is MARKED harvest-complete -- a message whose LABELS changed since is
 * still skipped, which is a decision the user took with its cost stated: a second run that
 * takes a minute instead of forty-three, at the price of a relabelling we will not notice
 * until something else makes us read the message.
 *
 * PRESENCE ALONE WAS THE TEST FOR ONE RELEASE, AND IT LOST A MAILBOX. It rested on a message's
 * record not reaching `raw.records` until its attachments had reached the lake -- true of
 * every row that rule wrote, and untrue of every row written before it, which is all of them
 * on a tenant that had already run. The 7,786 above is not an example: it is the mailbox, with
 * 7,786 records and zero documents, skipped whole on every run until ADR 0035 made the mark
 * something a landing states rather than something this file asserts. `harvest.ts` records the
 * contract, `collect.ts` counts what got down, and `knownRecords` reads the count.
 *
 * **One consequence, so nobody reads the filter below as unconditional:** the defence-in-
 * depth label check now runs only on a message this run actually fetched. A message we
 * already hold is never fetched, so a label removed from it after it landed does not
 * un-land it. Nothing widens -- what was stored was covered by the selection when it was
 * stored -- but the check is a check on new reads, not a sweep over the mailbox.
 */
export async function* harvestGmail(
  api: GoogleApi,
  scope: GmailScope,
  journal: RunJournal,
  held: AlreadyHeld,
): Harvest {
  const selected = new Set(scope.labels.map((l) => l.id));
  const messageIds = await listMessageIds(api, scope);
  // No timestamp: the listing carries none, so the only question this probe can put is
  // whether we hold the message, complete. See `RecordProbe` and `knownRecords`.
  const known = await held(messageIds.map((id) => ({ sourceRecordId: id, sourceUpdatedAt: null })));
  const toRead = messageIds.filter((id) => !known.has(id));

  // The most useful line this run writes. What follows is one paced request per message --
  // minutes for a real mailbox -- and until now the first sign of how long that would take
  // was the run ending. A total up front turns a blank screen into a quantity, and `skipped`
  // is what keeps "the mailbox is empty" and "nothing has changed" from being one sentence.
  journal.info("work_listed", { entity: ENTITY, total: messageIds.length, skipped: known.size });

  let read = 0;
  for (const messageId of toRead) {
    // The denominator is what is left to do, not what the mailbox holds: on a steady-state
    // mailbox the second is a gauge frozen at zero out of thousands.
    journal.progress("records_read", { entity: ENTITY, read, total: toRead.length });
    const message = await api.getJson(messageUrl(messageId), ENTITY, read);
    const labelIds = strings(getPath(message, "labelIds"));

    // Defence in depth: the query said what to fetch, this says what may be kept. A label
    // removed between the listing and the fetch, or a query built wrong, must not widen
    // what we store beyond what the admin agreed to.
    if (selected.size > 0 && !labelIds.some((id) => selected.has(id))) {
      continue;
    }

    const headers = headerMap(message);
    const internalDate = str(message, "internalDate");
    read += 1;
    yield {
      record: messageRecord(messageId, message, labelIds, internalDate),
      documents: matchingParts(message, scope.fileTypes).map((part) =>
        attachment(api, { messageId, headers, labelIds, internalDate }, part),
      ),
    };
  }

  // Never `seenIds`. A message that stopped matching a label selection was relabelled, not
  // deleted, and a tombstone would report a deletion that never happened.
  return { seenIds: null, skipped: [], listed: messageIds.length, known: known.size };
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
 * One matching attachment as a document to land.
 *
 * The split between `metadata` and `manifest` is the whole point and it is load-bearing:
 * `metadata` reaches `raw.documents`, which dbt and BI can read, so it carries opaque ids,
 * enumerations and counts only. Every name a human wrote goes in `manifest`, which lives in
 * the access-controlled object store. `pii.md`, ADR 0015.
 */
function attachment(api: GoogleApi, facts: MessageFacts, part: MatchingPart): DocumentToLand {
  const { messageId, headers, labelIds, internalDate } = facts;
  const { attachmentId } = part;

  return {
    // (messageId, partIndex), never attachmentId. See the module docstring.
    documentId: `${messageId}:${String(part.index).padStart(3, "0")}`,
    // An attachment Gmail could only call `application/octet-stream` is filed under what its
    // extension says when the catalogue knows it -- a `.oa` as JSON. `fileFormats.ts`.
    contentType: landedType({ mimeType: part.mimeType, name: part.filename }),
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

/**
 * `format=full`, which is the ONLY format that carries attachments.
 *
 * Google's Format reference: `metadata` "Returns only email message ID, labels, and email
 * headers" -- no `payload.parts`, so no `body.attachmentId`, so nothing for `matchingParts`
 * to walk. This asked for `metadata` and therefore landed zero attachments for every tenant,
 * while the suite stayed green because its fixture answered a metadata request with parts.
 *
 * `metadataHeaders` is dropped because it does nothing at this format; `headerMap` keeps the
 * same six headers on the way in instead. What comes back that we do NOT want -- bodies,
 * snippet, the full header set -- is never read and never landed, which is the part that
 * matters and the part `headerMap` and `messageRecord` are pinned on.
 */
function messageUrl(messageId: string): string {
  const url = new URL(`${GMAIL_BASE}/messages/${encodeURIComponent(messageId)}`);
  url.searchParams.set("format", "full");
  return url.toString();
}

interface MatchingPart {
  readonly index: number;
  readonly attachmentId: string;
  readonly filename: string;
  readonly size: string;
  readonly mimeType: string;
}

/**
 * Every attachment in a message whose type the scope allows, walked depth-first.
 *
 * Recursive because a forwarded mail nests `parts` inside `parts`, and an attachment two
 * levels down is still an attachment. The index counts every part visited, so it is stable
 * for a given message shape -- which is what makes it usable as half of the document id.
 */
function matchingParts(message: unknown, fileTypes: readonly string[]): MatchingPart[] {
  const found: MatchingPart[] = [];
  let index = 0;

  function walk(part: unknown): void {
    index += 1;
    const mimeType = str(part, "mimeType");
    const attachmentId = str(part, "body.attachmentId");
    const filename = str(part, "filename");
    if (allowsFile(fileTypes, { mimeType, name: filename }) && attachmentId !== "") {
      found.push({
        index,
        attachmentId,
        filename,
        size: str(part, "body.size") || "0",
        mimeType,
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

/**
 * The six headers the consent names, keyed by their lowercase spelling.
 *
 * A sender writes the header name and Gmail passes it through, so `Subject` and `SUBJECT`
 * are the same header; matching case-insensitively and storing under the canonical spelling
 * is what keeps `headers.Subject` answering for both.
 */
const KEPT_HEADERS: ReadonlyMap<string, string> = new Map(
  HEADERS.map((name) => [name.toLowerCase(), name] as const),
);

/**
 * The consent's six headers, and nothing else.
 *
 * This filter is load-bearing NOW in a way it was not before. `format=metadata` returned only
 * the headers `metadataHeaders` asked for, so taking all of them took six; `format=full`
 * returns every header a message carries -- Received chains, DKIM signatures, X-* internals,
 * each of which is more about the sender than the invoice is. Widening the fetch to reach
 * attachments must not widen what lands in `raw.records`, so the narrowing moves here.
 */
function headerMap(message: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const header of asArray(getPath(message, "payload.headers"))) {
    const canonical = KEPT_HEADERS.get(str(header, "name").toLowerCase());
    if (canonical !== undefined) {
      out[canonical] = str(header, "value");
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

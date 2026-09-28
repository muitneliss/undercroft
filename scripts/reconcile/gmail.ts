/**
 * Gmail, read-only: the account a token reads, message listings, and message metadata.
 *
 * HEADER NAMES ARE CASE-INSENSITIVE. RFC 5322 says so and senders use it: `Message-Id`,
 * `MESSAGE-ID`. Gmail returns each header under the sender's spelling, so `getMessage` stores
 * it under the name the suite asked for; a reader keyed on one spelling reads `Message-Id` as
 * absent and reports a content mismatch that is not there. CT-GG-003 pins it.
 */

import type { GoogleApi } from "./google.ts";
import { arrayOrEmpty, asObject, count, objectOrEmpty, stringOrNull, text } from "./json.ts";
import { type Walk, walkPages } from "./paginate.ts";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const RUNAWAY_PAGES = 2000;
const METADATA_HEADERS = ["Message-ID", "Subject", "From", "Date"];
const CANONICAL = new Map(METADATA_HEADERS.map((name) => [name.toLowerCase(), name] as const));

export interface Profile {
  readonly emailAddress: string;
  readonly messagesTotal: number;
  readonly historyId: string;
}

export interface ListParams {
  readonly q?: string;
  readonly labelIds?: readonly string[];
  readonly includeSpamTrash?: boolean;
}

export interface GmailMessage {
  readonly id: string;
  readonly threadId: string;
  readonly labelIds: readonly string[];
  readonly internalDate: string;
  /** Header name -> value, under the names requested in `METADATA_HEADERS`. */
  readonly headers: Readonly<Record<string, string>>;
}

/** The six headers the Undercroft connector keeps (`From`, `To`, `Cc`, `Subject`, `Date`, `Message-ID`). */
export const CONNECTOR_HEADERS = ["From", "To", "Cc", "Subject", "Date", "Message-ID"] as const;
const CONNECTOR_CANONICAL = new Map(
  CONNECTOR_HEADERS.map((name) => [name.toLowerCase(), name] as const),
);

/** One MIME part as the connector walks it: depth-first, every part counted from 1. */
export interface MessagePart {
  readonly index: number;
  readonly mimeType: string;
  readonly filename: string;
  /** `body.size` as Gmail sends it, a decimal string; "0" when absent. */
  readonly size: string;
  readonly hasAttachmentId: boolean;
}

/** A message read the way the connector reads it (`format=full`), bodies left behind. */
export interface FullMessage {
  readonly id: string;
  readonly threadId: string;
  readonly labelIds: readonly string[];
  readonly internalDate: string;
  /** Canonical header name -> every value it carries, in order. Only the connector's six. */
  readonly headerValues: Readonly<Record<string, readonly string[]>>;
  readonly parts: readonly MessagePart[];
}

export interface LabelInfo {
  readonly id: string;
  readonly type: string;
  readonly messagesTotal: number;
}

/** A label as the mailbox names it. The name is the customer's own words: PII, never logged. */
export interface LabelName {
  readonly id: string;
  readonly name: string;
}

/**
 * Explicit levels of `parts` in the partial response, so part bodies are not downloaded. The
 * innermost level asks for `parts` whole: a deeper tree still arrives, only heavier, and the
 * depth-first numbering never loses a part.
 */
const PART_LEVELS = 6;

function partFields(depth: number): string {
  const leaf = "partId,mimeType,filename,body/size,body/attachmentId";
  return depth === 0 ? "parts" : `parts(${leaf},${partFields(depth - 1)})`;
}

export const FULL_FIELDS = `id,threadId,labelIds,internalDate,payload(headers,${partFields(PART_LEVELS)})`;

export class GmailReader {
  readonly #api: GoogleApi;

  constructor(api: GoogleApi) {
    this.#api = api;
  }

  async profile(): Promise<Profile> {
    const body = objectOrEmpty(await this.#api.get(`${GMAIL}/profile`));
    return {
      emailAddress: text(body.emailAddress),
      messagesTotal: count(body.messagesTotal),
      historyId: text(body.historyId),
    };
  }

  listMessages(params: ListParams): Promise<Walk<string>> {
    return walkPages(
      async (cursor) => {
        const body = objectOrEmpty(await this.#api.get(listUrl(params, cursor)));
        return {
          items: arrayOrEmpty(body.messages).map((item) => text(asObject(item).id)),
          next: stringOrNull(body.nextPageToken),
        };
      },
      { maxPages: RUNAWAY_PAGES, idOf: (id) => id },
    );
  }

  async getMessage(id: string): Promise<GmailMessage | null> {
    const params = new URLSearchParams({ format: "metadata" });
    for (const header of METADATA_HEADERS) {
      params.append("metadataHeaders", header);
    }
    const body = await this.#api.get(`${GMAIL}/messages/${encodeURIComponent(id)}?${params}`, true);
    return body === null ? null : toMessage(body, id);
  }

  /** The message as the connector fetches it; `null` when Gmail answers 404. */
  async getFull(id: string): Promise<FullMessage | null> {
    const params = new URLSearchParams({ format: "full", fields: FULL_FIELDS });
    const body = await this.#api.get(`${GMAIL}/messages/${encodeURIComponent(id)}?${params}`, true);
    return body === null ? null : toFullMessage(body, id);
  }

  /** Every label the mailbox has, system and user, with the id a listing must be given. */
  async labels(): Promise<LabelName[]> {
    const body = objectOrEmpty(await this.#api.get(`${GMAIL}/labels`));
    return arrayOrEmpty(body.labels).map((item) => {
      const label = asObject(item);
      return { id: text(label.id), name: text(label.name) };
    });
  }

  /** One label's own count, which Gmail keeps apart from any listing. */
  async label(id: string): Promise<LabelInfo | null> {
    const body = await this.#api.get(`${GMAIL}/labels/${encodeURIComponent(id)}`, true);
    return body === null
      ? null
      : { id: text(body.id), type: text(body.type), messagesTotal: count(body.messagesTotal) };
  }
}

function toFullMessage(body: Record<string, unknown>, id: string): FullMessage {
  const payload = objectOrEmpty(body.payload);
  const headerValues: Record<string, string[]> = {};
  for (const item of arrayOrEmpty(payload.headers)) {
    const header = asObject(item);
    const name = CONNECTOR_CANONICAL.get(text(header.name).toLowerCase());
    if (name !== undefined) {
      headerValues[name] = [...(headerValues[name] ?? []), text(header.value)];
    }
  }
  return {
    id: text(body.id ?? id),
    threadId: text(body.threadId),
    labelIds: arrayOrEmpty(body.labelIds).map(text),
    internalDate: text(body.internalDate),
    headerValues,
    parts: walkParts(payload),
  };
}

/**
 * Every part below the payload, depth-first, numbered from 1 in visiting order -- the order
 * the connector numbers a document's part index in. The payload itself is not a part.
 */
export function walkParts(payload: Record<string, unknown>): MessagePart[] {
  const found: MessagePart[] = [];
  let index = 0;
  function visit(item: unknown): void {
    index += 1;
    const part = objectOrEmpty(item);
    const body = objectOrEmpty(part.body);
    found.push({
      index,
      mimeType: text(part.mimeType),
      filename: text(part.filename),
      size: text(body.size ?? "") || "0",
      hasAttachmentId: text(body.attachmentId ?? "") !== "",
    });
    for (const child of arrayOrEmpty(part.parts)) {
      visit(child);
    }
  }
  for (const part of arrayOrEmpty(payload.parts)) {
    visit(part);
  }
  return found;
}

function listUrl(params: ListParams, cursor: string | null): string {
  const search = new URLSearchParams({ maxResults: "500" });
  if (params.q !== undefined) {
    search.set("q", params.q);
  }
  for (const label of params.labelIds ?? []) {
    search.append("labelIds", label);
  }
  // biome-ignore lint/security/noSecrets: a Gmail API parameter name, not a credential.
  search.set("includeSpamTrash", String(params.includeSpamTrash ?? false));
  if (cursor !== null) {
    search.set("pageToken", cursor);
  }
  return `${GMAIL}/messages?${search.toString()}`;
}

function toMessage(body: Record<string, unknown>, id: string): GmailMessage {
  const headers: Record<string, string> = {};
  for (const item of arrayOrEmpty(objectOrEmpty(body.payload).headers)) {
    const header = asObject(item);
    // First occurrence wins, as Gmail's own UI does.
    headers[canonicalHeader(text(header.name))] ??= text(header.value);
  }
  return {
    id: text(body.id ?? id),
    threadId: text(body.threadId),
    labelIds: arrayOrEmpty(body.labelIds).map(text),
    internalDate: text(body.internalDate),
    headers,
  };
}

/** A header name as it was requested (`Message-ID`), whatever case the sender used. */
export function canonicalHeader(name: string): string {
  return CANONICAL.get(name.toLowerCase()) ?? name;
}

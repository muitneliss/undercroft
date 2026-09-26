/**
 * Gmail, read-only: the account a token reads, message listings, and message metadata.
 *
 * HEADER NAMES ARE CASE-INSENSITIVE. RFC 5322 says so and senders use it: `Message-Id`,
 * `MESSAGE-ID`. Gmail returns each header under the sender's spelling, so `getMessage` stores
 * it under the name the suite asked for. The first live run read `Message-Id` as absent and
 * reported three false content mismatches; CT-GG-002b pins the fix.
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

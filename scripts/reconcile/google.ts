/**
 * Reading the sources themselves: Gmail and Google Drive, read-only, over the HTTP seam.
 *
 * THE SOURCE IS THE REFERENCE, SO ITS IDENTITY IS CHECKED FIRST. A token that has drifted to
 * another account answers every call and returns a different mailbox; a reconciliation over it
 * reports thousands of "missing" messages that were never the question. `profile()` names the
 * account a token actually reads, and the Gmail suite refuses to compare until it equals the
 * account both warehouses say they read.
 *
 * READ-ONLY SCOPES. Tokens are the authorized-user files the old warehouse's tooling already holds
 * (`gmail.readonly`, `drive.readonly`); this module only ever issues GETs to Google APIs and
 * one POST, to the token endpoint, to exchange the refresh token for an access token.
 *
 * NO PAGE CAP IS TRUSTED. Listings go through `walkPages`; the cap handed to it is a runaway
 * guard far above any real mailbox, and hitting it is reported as truncation.
 */

import type { Fetcher, HttpResponse } from "../../packages/connector-runtime/src/fetcher.ts";
import { DriveClient, type DriveFile, type DriveTree } from "./drive.ts";
import { ReconcileError } from "./errors.ts";
import { type GmailMessage, GmailReader, type ListParams, type Profile } from "./gmail.ts";
import { asObject, objectOrEmpty, text } from "./json.ts";
import type { Walk } from "./paginate.ts";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const RATE_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"]);
const MAX_ATTEMPTS = 6;

export interface AuthorizedUser {
  readonly refresh_token: string;
  readonly client_id: string;
  readonly client_secret: string;
  readonly token_uri?: string;
}

/** Authenticated GETs against Google APIs, with the retry policy both readers share. */
export class GoogleApi {
  readonly #fetcher: Fetcher;
  readonly #credentials: AuthorizedUser;
  #accessToken: string | null = null;

  constructor(fetcher: Fetcher, credentials: AuthorizedUser) {
    this.#fetcher = fetcher;
    this.#credentials = credentials;
  }

  /** GET a JSON body; `null` for a 404 when `allow404`, an error for anything else non-200. */
  async get(url: string, allow404 = false): Promise<Record<string, unknown> | null> {
    const headers = { authorization: `Bearer ${await this.#token()}` };
    for (let attempt = 1; ; attempt += 1) {
      const response = await this.#fetcher.send({ url, method: "GET", headers });
      if (response.status === 200) {
        return asObject(JSON.parse(response.text));
      }
      if (response.status === 404 && allow404) {
        return null;
      }
      if (!retryable(response.status, response.text) || attempt >= MAX_ATTEMPTS) {
        throw failure(`GET ${redact(url)}`, response);
      }
      await Bun.sleep(1000 * 2 ** attempt);
    }
  }

  async #token(): Promise<string> {
    if (this.#accessToken !== null) {
      return this.#accessToken;
    }
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.#credentials.refresh_token,
      client_id: this.#credentials.client_id,
      client_secret: this.#credentials.client_secret,
    }).toString();
    const response = await this.#fetcher.send({
      url: this.#credentials.token_uri ?? TOKEN_URL,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const parsed = response.status === 200 ? asObject(JSON.parse(response.text)) : {};
    if (typeof parsed.access_token !== "string") {
      throw failure("token refresh", response);
    }
    this.#accessToken = parsed.access_token;
    return this.#accessToken;
  }
}

export interface GoogleClient {
  profile: () => Promise<Profile>;
  listMessages: (params: ListParams) => Promise<Walk<string>>;
  /** Metadata for one message; `null` when Gmail answers 404 (deleted or never existed). */
  getMessage: (id: string) => Promise<GmailMessage | null>;
  driveFile: (id: string) => Promise<DriveFile | null>;
  driveTree: (rootId: string) => Promise<DriveTree>;
}

export function createGoogleClient(fetcher: Fetcher, credentials: AuthorizedUser): GoogleClient {
  const api = new GoogleApi(fetcher, credentials);
  const gmail = new GmailReader(api);
  const drive = new DriveClient(api);
  return {
    profile: () => gmail.profile(),
    listMessages: (params) => gmail.listMessages(params),
    getMessage: (id) => gmail.getMessage(id),
    driveFile: (id) => drive.file(id),
    driveTree: (rootId) => drive.tree(rootId),
  };
}

/**
 * Whether a failed call is worth repeating. Gmail answers a per-user rate limit with 403 and
 * reason `rateLimitExceeded`, not 429 -- a 403 that is a real permission refusal is not retried.
 */
export function retryable(status: number, body: string): boolean {
  if (status === 429 || status >= 500) {
    return true;
  }
  if (status !== 403) {
    return false;
  }
  return reasonsOf(body).some((reason) => RATE_REASONS.has(reason));
}

function reasonsOf(body: string): string[] {
  try {
    const error = objectOrEmpty(asObject(JSON.parse(body)).error);
    return Array.isArray(error.errors)
      ? error.errors.map((item) => text(asObject(item).reason))
      : [];
  } catch {
    return [];
  }
}

function failure(what: string, response: HttpResponse): ReconcileError {
  return new ReconcileError(`${what} -> ${response.status} ${safeError(response.text)}`, {
    code: "GOOGLE",
    status: response.status,
  });
}

/** The error code of a Google error body, never the body: bodies can echo request details. */
function safeError(body: string): string {
  try {
    const { error } = asObject(JSON.parse(body));
    if (typeof error === "string") {
      return error;
    }
    const detail = objectOrEmpty(error);
    return text(detail.status ?? detail.code);
  } catch {
    return "";
  }
}

/** A URL without its query string: queries carry client names and search terms. */
function redact(url: string): string {
  const index = url.indexOf("?");
  return index === -1 ? url : `${url.slice(0, index)}?…`;
}

/** Parse an authorized-user token file, keeping only the fields the refresh needs. */
export function parseAuthorizedUser(raw: string): AuthorizedUser {
  const body = asObject(JSON.parse(raw));
  function field(name: string): string {
    const value = body[name];
    if (typeof value !== "string" || value.length === 0) {
      throw new ReconcileError(`token file has no ${name}`, { code: "CONFIG" });
    }
    return value;
  }
  return {
    refresh_token: field("refresh_token"),
    client_id: field("client_id"),
    client_secret: field("client_secret"),
    ...(typeof body.token_uri === "string" ? { token_uri: body.token_uri } : {}),
  };
}

/**
 * Reading the source itself: Gmail, read-only, over the HTTP seam.
 *
 * THE SOURCE IS THE REFERENCE, SO ITS IDENTITY IS CHECKED FIRST. A token that has drifted to
 * another account answers every call and returns a different mailbox; a reconciliation over it
 * reports thousands of "missing" messages that were never the question. `profile()` names the
 * account a token actually reads, and the Gmail suite refuses to compare until it equals the
 * account the lake's connection says it reads.
 *
 * READ-ONLY SCOPE. Tokens are authorized-user files granted `gmail.readonly`; this module only
 * ever issues GETs to Google APIs and one POST, to the token endpoint, to exchange the refresh
 * token for an access token.
 *
 * NO PAGE CAP IS TRUSTED. Listings go through `walkPages`; the cap handed to it is a runaway
 * guard far above any real mailbox, and hitting it is reported as truncation.
 */

import type { Fetcher, HttpResponse } from "../../packages/connector-runtime/src/fetcher.ts";
import { ReconcileError } from "./errors.ts";
import {
  type FullMessage,
  type GmailMessage,
  GmailReader,
  type LabelInfo,
  type LabelName,
  type ListParams,
  type Profile,
} from "./gmail.ts";
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

/** Authenticated GETs against Google APIs, with their retry policy. */
export class GoogleApi {
  readonly #fetcher: Fetcher;
  readonly #credentials: AuthorizedUser;
  #accessToken: string | null = null;

  constructor(fetcher: Fetcher, credentials: AuthorizedUser) {
    this.#fetcher = fetcher;
    this.#credentials = credentials;
  }

  /**
   * GET a JSON body; `null` for a 404 when `allow404`, an error for anything else non-200.
   *
   * An access token lives an hour and a mailbox read at Gmail's real quota takes several, so a
   * 401 drops the token and the call is made once more with a fresh one. Before this, every read
   * after the first hour failed and its message became one the leg could not judge.
   */
  async get(url: string, allow404 = false): Promise<Record<string, unknown> | null> {
    let refreshed = false;
    for (let attempt = 1; ; attempt += 1) {
      const headers = { authorization: `Bearer ${await this.#token()}` };
      const response = await this.#fetcher.send({ url, method: "GET", headers });
      if (response.status === 200) {
        return asObject(JSON.parse(response.text));
      }
      if (response.status === 404 && allow404) {
        return null;
      }
      if (response.status === 401 && !refreshed) {
        refreshed = true;
        this.#accessToken = null;
        continue;
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
  /** The message as the connector reads it (`format=full`, bodies left out); `null` on 404. */
  getFull: (id: string) => Promise<FullMessage | null>;
  /** A label's own message count; `null` when the label does not exist. */
  label: (id: string) => Promise<LabelInfo | null>;
  /** Every label of the mailbox, id and name. */
  labels: () => Promise<readonly LabelName[]>;
}

export function createGoogleClient(fetcher: Fetcher, credentials: AuthorizedUser): GoogleClient {
  const api = new GoogleApi(fetcher, credentials);
  const gmail = new GmailReader(api);
  return {
    profile: () => gmail.profile(),
    listMessages: (params) => gmail.listMessages(params),
    getMessage: (id) => gmail.getMessage(id),
    getFull: (id) => gmail.getFull(id),
    label: (id) => gmail.label(id),
    labels: () => gmail.labels(),
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

/** A URL without its query string: a query can carry search terms and names. */
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

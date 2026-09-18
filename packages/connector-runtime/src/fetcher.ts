/**
 * The HTTP seam.
 *
 * Narrow on purpose: the real fetcher wraps `fetch`, and the in-memory one replays
 * recorded responses. Every test above this line runs offline with no credential, which
 * is what "fixture mode" is here -- not a second code path, but the same runtime driven by
 * a different fetcher.
 */

import { HttpError } from "@undercroft/core";

export interface HttpRequest {
  readonly url: string;
  readonly method: "GET" | "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly text: string;
}

export interface Fetcher {
  send(request: HttpRequest): Promise<HttpResponse>;
}

/** A fetcher over the platform's real `fetch`, with a timeout. */
export function createFetcher(timeoutMs = 60_000): Fetcher {
  return {
    async send(request: HttpRequest): Promise<HttpResponse> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(request.url, {
          method: request.method,
          headers: request.headers,
          ...(request.body === undefined ? {} : { body: request.body }),
          signal: controller.signal,
        });
        const text = await response.text();
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          headers[key.toLowerCase()] = value;
        });
        return { status: response.status, headers, text };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Turn a non-2xx response into the {@link HttpError} the retry policy understands. */
export function raiseForStatus(request: HttpRequest, response: HttpResponse): void {
  if (response.status >= 200 && response.status < 300) return;
  const retryAfter = response.headers["retry-after"] ?? null;
  // parseInt, not Number(): the money lint rule bans Number() everywhere, and this is a
  // seconds count, not an amount.
  const retryAfterMs =
    retryAfter !== null && /^\d+$/u.test(retryAfter)
      ? Number.parseInt(retryAfter, 10) * 1000
      : null;
  throw new HttpError(response.status, request.url, response.text.slice(0, 500), retryAfterMs);
}

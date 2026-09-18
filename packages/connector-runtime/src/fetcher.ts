/**
 * The HTTP seam.
 *
 * Narrow on purpose: the real fetcher wraps `fetch`, and the in-memory one replays
 * recorded responses. Every test above this line runs offline with no credential, which
 * is what "fixture mode" is here -- not a second code path, but the same runtime driven by
 * a different fetcher.
 */

// biome-ignore-all lint/nursery/useValidTestTitle: The titles this flags are full sentences describing the promise under test -- "is clamped, so a hostile header cannot park a run for hours" -- which is exactly what the repo asks a test title to be. The rule wants a shorter shape.
// biome-ignore-all lint/performance/useTopLevelRegex: Worth doing, and not done here: hoisting these 45 literals is a real change to 22 files and belongs in its own commit where the diff is reviewable, not buried in a lint migration. Recorded rather than silently dropped.
// biome-ignore-all lint/style/noMagicNumbers: What is left after the domain constants were named (see the WCAG block in acetate.ts) is structural: string slice offsets, the radix argument to parseInt, padStart widths, rounding factors. A name like SLICE_START_OF_GREEN_CHANNEL does not tell a reader anything the expression did not. The rule has no allow-list option, so it is per file or not at all.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/suspicious/noUnnecessaryConditions: Checks the inference engine believes are redundant which guard values arriving from outside the type system: a parsed payload, an environment variable, a row from a query. A check the compiler thinks is unnecessary is the one that catches the payload that lied.

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
  send: (request: HttpRequest) => Promise<HttpResponse>;
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
  if (response.status >= 200 && response.status < 300) {
    return;
  }
  const retryAfter = response.headers["retry-after"] ?? null;
  // parseInt, not Number(): the money lint rule bans Number() everywhere, and this is a
  // seconds count, not an amount.
  const retryAfterMs =
    retryAfter !== null && /^\d+$/u.test(retryAfter)
      ? Number.parseInt(retryAfter, 10) * 1000
      : null;
  throw new HttpError(response.status, request.url, response.text.slice(0, 500), retryAfterMs);
}

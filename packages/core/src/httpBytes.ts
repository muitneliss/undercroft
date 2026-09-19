/**
 * The HTTP seam for responses that are not text.
 *
 * `@undercroft/connector-runtime`'s `Fetcher` consumes every body with `response.text()`,
 * which is right for a REST source whose records are JSON and fatal for a PDF: once the
 * body has been decoded as UTF-8 the bytes are unrecoverable, and re-encoding the string
 * does not give them back. So a source that carries documents -- a Gmail attachment, a
 * Drive file -- needs a fetcher that hands over the bytes.
 *
 * This lives in `@undercroft/core` and not beside the text one because everything it has
 * to compose with already lives here: `createPacer`, `withRetry`, `HttpError`, `Clock`.
 * `email.ts` is the precedent for the shape -- the interface, the real implementation and
 * the in-memory one in a single module, so a caller cannot reach for the real thing in a
 * test by accident.
 *
 * It is deliberately NOT a superset of the text fetcher. Two narrow seams that each do one
 * thing are easier to reason about than one seam with a mode flag, and the runtime's
 * `Fetcher` is load-bearing for four connectors that must not change.
 */

import { HttpError } from "./errors.ts";

const DEFAULT_TIMEOUT_MS = 60_000;
const OK_MIN = 200;
const OK_MAX = 300;
/** How much of an error body to keep. Enough to carry a provider's message, never a file. */
const EXCERPT_BYTES = 500;
const MS_PER_SECOND = 1000;
/** `Retry-After` in its delay-seconds form; the HTTP-date form is handled by `retry.ts`. */
const WHOLE_SECONDS = /^\d+$/u;

export interface ByteRequest {
  readonly url: string;
  readonly method: "GET" | "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface ByteResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly bytes: Uint8Array;
}

export interface ByteFetcher {
  send: (request: ByteRequest) => Promise<ByteResponse>;
}

/** A byte fetcher over the platform's real `fetch`, with a timeout. */
export function createByteFetcher(timeoutMs = DEFAULT_TIMEOUT_MS): ByteFetcher {
  return {
    async send(request: ByteRequest): Promise<ByteResponse> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(request.url, {
          method: request.method,
          headers: request.headers,
          ...(request.body === undefined ? {} : { body: request.body }),
          signal: controller.signal,
        });
        const bytes = new Uint8Array(await response.arrayBuffer());
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          headers[key.toLowerCase()] = value;
        });
        return { status: response.status, headers, bytes };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * Turn a non-2xx response into the {@link HttpError} the retry policy understands.
 *
 * The excerpt is decoded non-fatally and byte-capped. A provider's error body is JSON and
 * reads well; a truncated binary body is mojibake, which is ugly but harmless -- whereas a
 * strict decoder would throw *while building an error message*, replacing a useful 503 with
 * a TypeError from the logging path.
 */
export function raiseForByteStatus(request: ByteRequest, response: ByteResponse): void {
  if (response.status >= OK_MIN && response.status < OK_MAX) {
    return;
  }
  const retryAfter = response.headers["retry-after"] ?? null;
  // parseInt, not Number(): the money rule bans Number() repo-wide, and this is a seconds
  // count rather than an amount.
  const retryAfterMs =
    retryAfter !== null && WHOLE_SECONDS.test(retryAfter)
      ? Number.parseInt(retryAfter, 10) * MS_PER_SECOND
      : null;
  const excerpt = new TextDecoder("utf-8", { fatal: false }).decode(
    response.bytes.slice(0, EXCERPT_BYTES),
  );
  throw new HttpError(response.status, request.url, excerpt, retryAfterMs);
}

export interface RecordedByteResponse {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  /** A `Uint8Array` verbatim, a string as UTF-8, anything else as JSON. */
  readonly body: unknown;
}

/**
 * An in-memory {@link ByteFetcher} that replays recorded responses.
 *
 * A real implementation of the seam, not a mock: pacing, retry, pagination and the size
 * guard are all genuinely exercised against it. **An unmodelled request rejects**, which is
 * the property that makes the offline gate worth running -- a collector that calls an
 * endpoint nobody recorded fails loudly rather than yielding nothing and reading as "the
 * mailbox is empty".
 */
export class InMemoryByteFetcher implements ByteFetcher {
  readonly #routes = new Map<string, RecordedByteResponse[]>();
  readonly #calls: ByteRequest[] = [];

  /** Record a response for a method+URL. Repeated calls queue successive responses. */
  on(method: string, url: string, response: RecordedByteResponse): this {
    const key = `${method} ${url}`;
    const queue = this.#routes.get(key) ?? [];
    queue.push(response);
    this.#routes.set(key, queue);
    return this;
  }

  get calls(): readonly ByteRequest[] {
    return this.#calls;
  }

  send(request: ByteRequest): Promise<ByteResponse> {
    this.#calls.push(request);
    const key = `${request.method} ${request.url}`;
    const queue = this.#routes.get(key);
    if (queue === undefined || queue.length === 0) {
      const known = [...this.#routes.keys()].join("\n  ") || "(nothing recorded)";
      return Promise.reject(
        new Error(`no recorded response for ${key}\nrecorded routes:\n  ${known}`),
      );
    }
    // Keep the last recorded response available for repeated identical requests.
    const recorded = queue.length > 1 ? queue.shift() : queue[0];
    return Promise.resolve({
      status: recorded?.status ?? OK_MIN,
      headers: recorded?.headers ?? {},
      bytes: encodeRecorded(recorded?.body),
    });
  }
}

function encodeRecorded(body: unknown): Uint8Array {
  if (body instanceof Uint8Array) {
    return body;
  }
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new TextEncoder().encode(text);
}

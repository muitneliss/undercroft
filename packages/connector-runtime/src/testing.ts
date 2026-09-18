/**
 * An in-memory {@link Fetcher} that replays recorded responses.
 *
 * A real implementation of the seam, not a mock: it matches on method and URL and returns
 * recorded bytes, so the paginator, the extractor and the guards are genuinely exercised.
 * An unmodelled request is an error, never a silent empty response -- the discipline that
 * stops a connector calling an endpoint nobody recorded and rendering an empty state that
 * looks deliberate.
 */

// biome-ignore-all lint/style/noMagicNumbers: What is left after the domain constants were named (see the WCAG block in acetate.ts) is structural: string slice offsets, the radix argument to parseInt, padStart widths, rounding factors. A name like SLICE_START_OF_GREEN_CHANNEL does not tell a reader anything the expression did not. The rule has no allow-list option, so it is per file or not at all.
// biome-ignore-all lint/style/noNonNullAssertion: Almost all of these are tests asserting on a fixture they created three lines earlier, which the ESLint config this replaced also exempted for the same reason. Biome's unsafe autofix for the rule deletes the `!` and leaves `string | undefined` flowing into a `string`, so it does not compile.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.

import type { Fetcher, HttpRequest, HttpResponse } from "./fetcher.ts";

export interface RecordedResponse {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly body: unknown;
}

export class InMemoryFetcher implements Fetcher {
  readonly #routes = new Map<string, RecordedResponse[]>();
  readonly #calls: HttpRequest[] = [];

  /** Record a response for a method+URL. Repeated calls queue successive responses. */
  on(method: string, url: string, response: RecordedResponse): this {
    const key = `${method} ${url}`;
    const queue = this.#routes.get(key) ?? [];
    queue.push(response);
    this.#routes.set(key, queue);
    return this;
  }

  get calls(): readonly HttpRequest[] {
    return this.#calls;
  }

  send(request: HttpRequest): Promise<HttpResponse> {
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
    const recorded = queue.length > 1 ? queue.shift()! : queue[0]!;
    const text = typeof recorded.body === "string" ? recorded.body : JSON.stringify(recorded.body);
    return Promise.resolve({
      status: recorded.status ?? 200,
      headers: recorded.headers ?? {},
      text,
    });
  }
}

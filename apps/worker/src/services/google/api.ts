/**
 * The Google HTTP client: paced, retried, and able to return bytes.
 *
 * Gmail and Drive are not connector specs. The spec format reads JSON records over a text
 * fetcher, and neither source fits: Gmail carries attachment bodies as base64url inside a
 * message part, Drive serves file content from `?alt=media` as raw bytes, and both need a
 * request shape (one query per selected label; one listing per picked folder) that no
 * declarative pagination kind expresses. ADR 0004 names this case and names the answer --
 * what a spec cannot express is landed by a first-party caller instead of growing the
 * format for two exotic sources.
 *
 * What is NOT rebuilt here is everything the runtime already got right: `createPacer` and
 * `withRetry` come from `@undercroft/core` on an injected `Clock`, so rate-limit and
 * back-off behaviour is exercised in the offline gate without anything sleeping.
 *
 * Every request in this module goes through `send`, which is the one place that paces,
 * retries, raises for status and attaches the token. A second fetch path would be a second
 * place for a 429 to go unhandled.
 */

// biome-ignore-all lint/nursery/usePlaywrightValidDescribeCallback: Playwright-domain rule. There is no Playwright in this repo.
// biome-ignore-all lint/nursery/useValidTestTitle: A false positive. The rule reads `/\s/.test(value)` -- RegExp#test on a regex literal -- as a test-framework `test()` call with a non-string title. There is no test in this file.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useErrorCause: Two throws that deliberately do not chain: the original carries a provider's raw response, and attaching it would put an unreviewed payload into a log line.
// biome-ignore-all lint/style/useExportsLast: Reordering 28 modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. The ordering carries meaning here and the rule's preferred one does not.

import {
  type ByteFetcher,
  type ByteRequest,
  type Clock,
  ConnectorError,
  createPacer,
  DEFAULT_RETRY,
  type Pacer,
  parseLossless,
  raiseForByteStatus,
  type RetryPolicy,
  systemClock,
  withRetry,
} from "@undercroft/core";

/**
 * Google's documented ceiling is far higher, but per-user quota is what actually bites, and
 * a backfill that trips it costs more in 429s than the pacing saves. 120ms leaves headroom.
 */
export const GOOGLE_MIN_INTERVAL_MS = 120;

export interface GoogleApiDeps {
  readonly fetcher: ByteFetcher;
  /**
   * Resolves a bearer token. Called per request, so a refresh mid-run is picked up.
   *
   * A property rather than a method: it is passed by reference between deps objects, and a
   * method separated from its object carries a `this` nobody intended.
   */
  readonly token: () => Promise<string>;
  readonly clock?: Clock;
  readonly pacer?: Pacer;
  readonly retry?: RetryPolicy;
  readonly random?: () => number;
}

export interface GoogleApi {
  /** A JSON body, parsed losslessly so a large id never round-trips through a float. */
  getJson: (url: string, entity: string, seen?: number) => Promise<unknown>;
  /** Raw bytes: a Drive download, or anything else that is not JSON. */
  getBytes: (url: string, entity: string, seen?: number) => Promise<Uint8Array>;
}

export function createGoogleApi(source: string, deps: GoogleApiDeps): GoogleApi {
  const clock = deps.clock ?? systemClock;
  const pacer = deps.pacer ?? createPacer({ minIntervalMs: GOOGLE_MIN_INTERVAL_MS }, clock);
  const retry = deps.retry ?? DEFAULT_RETRY;

  /**
   * `seen` is the collector's running count of records landed so far, passed down rather
   * than counted here: a count local to one request would always be 0 on failure, which is
   * exactly the signal `ConnectorError` carries it to preserve. "Failed after 412" is a
   * transient upstream fault; "failed after 0" is a credential problem; they want different
   * responses from whoever reads the log.
   */
  async function send(
    url: string,
    entity: string,
    accept: string,
    seen: number,
  ): Promise<Uint8Array> {
    try {
      return await withRetry(
        async () => {
          await pacer.acquire();
          const request: ByteRequest = {
            url,
            method: "GET",
            headers: { authorization: `Bearer ${await deps.token()}`, accept },
          };
          const response = await deps.fetcher.send(request);
          raiseForByteStatus(request, response);
          return response.bytes;
        },
        retry,
        {
          clock,
          ...(deps.random === undefined ? {} : { random: deps.random }),
        },
      );
    } catch (error) {
      // Never an empty result on failure -- a collector that swallowed this would publish
      // an empty table and call the run green.
      throw new ConnectorError(source, entity, seen, describe(error), { cause: error });
    }
  }

  return {
    async getJson(url: string, entity: string, seen = 0): Promise<unknown> {
      const bytes = await send(url, entity, "application/json", seen);
      return parseLossless(new TextDecoder().decode(bytes));
    },
    getBytes(url: string, entity: string, seen = 0): Promise<Uint8Array> {
      return send(url, entity, "*/*", seen);
    },
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

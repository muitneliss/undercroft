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

import {
  type ByteFetcher,
  type ByteRequest,
  type Clock,
  ConnectorError,
  createPacer,
  DEFAULT_RETRY,
  HttpError,
  type Pacer,
  parseLossless,
  raiseForByteStatus,
  type RetryPolicy,
  systemClock,
  withRetry,
} from "@undercroft/core";

/**
 * One request per 334ms: three a second, inside the 2-4 `messages.get`/second/user that
 * Gmail actually enforces for this project.
 *
 * This was 120ms -- 8.3 a second -- on the reasoning that Google's DOCUMENTED per-user
 * ceiling (15,000 quota units a minute, 5 units a `messages.get`, so 50 a second) left
 * ample headroom. The documented ceiling is not the enforced one. A 7,777-message backfill
 * died 378 messages in, roughly 45 seconds, with `403 Quota exceeded for quota metric
 * 'Total Query Cost' and limit 'Units per minute per user'` -- at a measured 2,500 units a
 * minute, a sixth of the published limit. The enforced rate is 2-4 a second, and 3 is the
 * middle of that rather than a ride along its ceiling.
 *
 * It costs a 7,777-message mailbox about 43 minutes on a FIRST read. That is the trade, and
 * it is worth taking: the 16-minute version does not finish.
 *
 * The reason it was worth taking was once sharper than it is now, and the sharper version is
 * worth keeping because it is what this number was chosen against. `harvestGmail` used to
 * buffer the whole mailbox and `runGoogleCollect` landed it at the end, so a run that
 * tripped the quota discarded every record it had read -- forty-three minutes for nothing,
 * and no faster rate could ever be tried because there was nothing to resume from. Both
 * halves are now streamed: a chunk of 200 is in the lake and in `raw.records` as it is read,
 * a killed run costs one chunk, and a second run skips what the first landed. So the cost of
 * being wrong about the rate is a chunk rather than a run. Three a second is still the
 * middle of the enforced 2-4 and still what this deployment paces at -- pacing that trips
 * the quota is a run that fails, not a run that goes slightly slower.
 *
 * `UNDERCROFT_GOOGLE_MIN_INTERVAL_MS` overrides it, because the enforced number belongs to
 * the Cloud project rather than to Google, and the next deployment's may differ. See
 * {@link googleMinIntervalMs}.
 */
export const GOOGLE_MIN_INTERVAL_MS = 334;

/** The env var that overrides the pacing, for a project whose enforced quota differs. */
export const GOOGLE_INTERVAL_ENV = "UNDERCROFT_GOOGLE_MIN_INTERVAL_MS";

/**
 * Gmail's rate-limit reasons, which arrive as 403 rather than 429.
 *
 * FOUR SPELLINGS, BECAUSE MATCHING ONLY THE REASON IS A COIN TOSS. `raiseForByteStatus`
 * keeps the first 500 bytes of the body, and in the quota error Google actually sent for
 * this project, `"reason": "rateLimitExceeded"` ENDS AT BYTE 499 of a pretty-printed body --
 * inside the cap by one byte. The message it follows is repeated twice before it, so a
 * consumer name one character longer moves the token two bytes and truncates it: measured,
 * `project_number:1823022475567` (one more digit than ours) puts it at 484-501 and the match
 * is gone. A guard that fires on where a byte cap happened to fall is not a guard.
 *
 * So the human-readable half is matched too. `Quota exceeded` and `RESOURCE_EXHAUSTED` are
 * within the first hundred bytes, and neither can mean anything but a quota: a missing
 * scope is `insufficientPermissions`, an API nobody enabled is `accessNotConfigured`.
 * `userRateLimitExceeded` is listed separately because its capital `R` means the
 * `rateLimitExceeded` alternative does not match it.
 */
const RATE_LIMITED = /rateLimitExceeded|userRateLimitExceeded|RESOURCE_EXHAUSTED|Quota exceeded/u;

/**
 * A cap no run can wait out, which therefore must NOT be retried.
 *
 * Google words a daily exhaustion in the same "Quota exceeded for quota metric" sentence as
 * a per-minute one, so widening {@link RATE_LIMITED} to the message text pulls the daily cap
 * in with it. Sleeping three minutes on a quota that resets at midnight is the mistake
 * `pacer.ts` refuses by name with `QuotaExhausted`: a worker parked, appearing to make
 * progress. This therefore wins over `RATE_LIMITED`.
 */
const DAILY_CAP = /dailyLimitExceeded|per day/u;
const FORBIDDEN = 403;
const INTEGER_MS = /^\d+$/u;

/**
 * `DEFAULT_RETRY`, plus the two things that are true of Google and not of HTTP generally.
 *
 * **Gmail does not answer a rate limit with 429.** It answers **`403 rateLimitExceeded`**
 * (or `userRateLimitExceeded`, or a `Quota exceeded` message), and Google's own error guide
 * says to back off and retry exactly those. With 403 absent from `on`, a backfill died
 * mid-mailbox the moment the per-user quota bit -- observed as "gmail/messages failed after
 * 196 records: HTTP 403".
 *
 * Deliberately NOT `on: [403]`. The same status is also how Google says "the customer never
 * granted that scope", which is not transient: retrying it with backoff turns a clear
 * refusal into a slow one and tells the operator nothing new. So the REASON decides, and
 * every direction is pinned by tests.
 *
 * **The budget has to outlast the window it waits on.** `DEFAULT_RETRY` spends four sleeps
 * of at most 500/1000/2000/4000ms -- 7.5 seconds at the very worst, under 4 on average. The
 * quota that bites here names its own window: `limit 'Units per minute per user'`. Four
 * seconds of backoff against a minute-long window spends every attempt inside the same
 * window that refused the first one, so all of them are refused and a 43-minute backfill
 * ends over a stall it only had to sit out. Seven sleeps from a 2s base, capped at 60s,
 * spend about 91 seconds of expected backoff and at most 182 -- past the window, and still
 * bounded rather than a worker parked forever.
 *
 * Full jitter is kept rather than traded for a deterministic wait: every tenant's run bills
 * to the same Cloud project, so two backfills that trip the same quota must not come back in
 * step.
 */
export const GOOGLE_RETRY: RetryPolicy = {
  ...DEFAULT_RETRY,
  attempts: 8,
  baseMs: 2000,
  maxMs: 60_000,
  retryWhen: (error) =>
    error.status === FORBIDDEN &&
    !DAILY_CAP.test(error.bodyExcerpt) &&
    RATE_LIMITED.test(error.bodyExcerpt),
};

/**
 * The pacing this deployment should use: the env override, or {@link GOOGLE_MIN_INTERVAL_MS}.
 *
 * An unreadable value RAISES rather than falling back. The default is what caused the outage
 * this function exists because of, so quietly returning to it on a typo would hide the one
 * setting an operator reached for to stop that happening again -- and the symptom would be
 * another dead backfill 45 seconds in, with the variable sitting in the compose file looking
 * applied. Rule 2: never guess, say why.
 *
 * Takes the environment as an argument rather than reading it: `layering.md` keeps
 * `process.env` above this layer, and `server.ts` already passes `env` down through
 * `RunDeps`.
 */
export function googleMinIntervalMs(env: NodeJS.ProcessEnv = {}): number {
  const raw = env[GOOGLE_INTERVAL_ENV]?.trim();
  if (raw === undefined || raw === "") {
    return GOOGLE_MIN_INTERVAL_MS;
  }
  // parseInt, not Number(): a millisecond interval is a count, not an amount. The money rule
  // bans Number() repo-wide; same reasoning as the port in `server.ts`.
  if (!INTEGER_MS.test(raw) || Number.parseInt(raw, 10) <= 0) {
    throw new Error(
      `${GOOGLE_INTERVAL_ENV} must be a positive whole number of milliseconds; got ` +
        `${JSON.stringify(env[GOOGLE_INTERVAL_ENV])}. Gmail enforces about 2-4 ` +
        `messages.get/second/user, which the default ${GOOGLE_MIN_INTERVAL_MS} paces at three.`,
    );
  }
  return Number.parseInt(raw, 10);
}

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
  /**
   * Minimum gap between two requests. Defaults to {@link GOOGLE_MIN_INTERVAL_MS}; a caller
   * that has read the env passes {@link googleMinIntervalMs}. Ignored when `pacer` is given,
   * which is the seam a test uses to pace on a clock it controls.
   */
  readonly minIntervalMs?: number;
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
  const pacer =
    deps.pacer ??
    createPacer({ minIntervalMs: deps.minIntervalMs ?? GOOGLE_MIN_INTERVAL_MS }, clock);
  const retry = deps.retry ?? GOOGLE_RETRY;

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

/**
 * What the provider actually said, not merely which status it said it with.
 *
 * `raiseForByteStatus` captures a body excerpt and `HttpError`'s message drops it -- so the
 * one word that separates a rate limit from a revoked scope sat unused in memory while the
 * operator read a bare "HTTP 403". Both are 403 at Google; without the reason there is
 * nothing to act on. Rule 2: say why.
 */
function describe(error: unknown): string {
  if (error instanceof HttpError && error.bodyExcerpt !== "") {
    return `${error.message}: ${error.bodyExcerpt}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Retry with exponential backoff and full jitter.
 *
 * Three details here are not decoration:
 *
 * **Jitter is injected, not read from `Math.random`.** A backoff test that cannot fix the
 * randomness asserts on a range, and an assertion on a range passes for an implementation
 * that is subtly wrong.
 *
 * **`Retry-After` is honoured but clamped.** Servers send it in seconds or as an
 * HTTP-date, and both are legal; a malformed or hostile value must not park a run for
 * hours. `maxRetryAfterMs` is the ceiling.
 *
 * **Only listed statuses retry.** A 401 is not transient -- retrying it five times turns
 * a clear credential failure into a slow one, and on some providers into a lockout.
 */

// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: Same functions as noExcessiveLinesPerFunction: one sequential procedure each, whose branches are the states the thing being driven can actually be in.
// biome-ignore-all lint/nursery/useValidTestTitle: The titles this flags are full sentences describing the promise under test -- "is clamped, so a hostile header cannot park a run for hours" -- which is exactly what the repo asks a test title to be. The rule wants a shorter shape.
// biome-ignore-all lint/performance/noAwaitInLoops: These sequential awaits are the point. Pacing a connector against a rate limit, walking Dokploy deployment records until one settles, and migrating SQL files in order all require the previous iteration to finish first; running them concurrently is the bug this rule would introduce.
// biome-ignore-all lint/performance/useTopLevelRegex: Worth doing, and not done here: hoisting these 45 literals is a real change to 22 files and belongs in its own commit where the diff is reviewable, not buried in a lint migration. Recorded rather than silently dropped.
// biome-ignore-all lint/style/noIncrementDecrement: `i += 1` is already the form used throughout; what remains is inside for-loop headers, where `i++` is the idiom the language reads best.
// biome-ignore-all lint/style/noMagicNumbers: What is left after the domain constants were named (see the WCAG block in acetate.ts) is structural: string slice offsets, the radix argument to parseInt, padStart widths, rounding factors. A name like SLICE_START_OF_GREEN_CHANNEL does not tell a reader anything the expression did not. The rule has no allow-list option, so it is per file or not at all.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useExportsLast: Reordering 28 modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. The ordering carries meaning here and the rule's preferred one does not.

import { type Clock, systemClock } from "./clock.ts";
import { HttpError } from "./errors.ts";

export interface RetryPolicy {
  readonly attempts: number;
  readonly on: readonly number[];
  readonly backoff: "exponential" | "fixed";
  readonly baseMs: number;
  readonly maxMs: number;
  readonly jitter: "full" | "none";
  readonly respectRetryAfter: boolean;
  readonly maxRetryAfterMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = {
  attempts: 5,
  on: [429, 500, 502, 503, 504],
  backoff: "exponential",
  baseMs: 500,
  maxMs: 30_000,
  jitter: "full",
  respectRetryAfter: true,
  maxRetryAfterMs: 120_000,
};

export interface RetryDeps {
  readonly clock?: Clock;
  /** Returns a value in [0, 1). Injected so backoff is assertable, not approximable. */
  readonly random?: () => number;
  /** Called before each sleep, for structured logging. */
  readonly onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

/**
 * Parse a `Retry-After` header. Seconds or an HTTP-date; anything else is `null`.
 *
 * Returned unclamped -- clamping is the policy's job, and separating them means the
 * parser can be tested for what the server said rather than for what we chose to do
 * about it.
 */
export function parseRetryAfter(header: string | null, now: Date): number | null {
  if (header === null) {
    return null;
  }
  const trimmed = header.trim();
  if (/^\d+$/u.test(trimmed)) {
    return Number.parseInt(trimmed, 10) * 1000;
  }
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) {
    return null;
  }
  return Math.max(0, at - now.getTime());
}

function backoffFor(policy: RetryPolicy, attempt: number, random: () => number): number {
  const raw = policy.backoff === "fixed" ? policy.baseMs : policy.baseMs * 2 ** (attempt - 1);
  const capped = Math.min(raw, policy.maxMs);
  return policy.jitter === "full" ? Math.floor(capped * random()) : capped;
}

function isRetryable(error: unknown, policy: RetryPolicy): boolean {
  return error instanceof HttpError && policy.on.includes(error.status);
}

export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  policy: RetryPolicy = DEFAULT_RETRY,
  deps: RetryDeps = {},
): Promise<T> {
  const clock = deps.clock ?? systemClock;
  const random = deps.random ?? Math.random;

  for (let attempt = 1; ; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= policy.attempts || !isRetryable(error, policy)) {
        throw error;
      }

      const asked =
        policy.respectRetryAfter && error instanceof HttpError ? error.retryAfterMs : null;
      const delayMs =
        asked === null
          ? backoffFor(policy, attempt, random)
          : Math.min(asked, policy.maxRetryAfterMs);

      deps.onRetry?.({ attempt, delayMs, error });
      await clock.sleep(delayMs);
    }
  }
}

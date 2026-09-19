// biome-ignore-all lint/nursery/noUnsafeTypeAssertion: Every one of these is a boundary where a payload genuinely is unknown -- a third-party API body, a Docker inspect response, a row shape from a hand-written query -- and is Zod-parsed or checked immediately after. Making the assertions safe means modelling each external shape as a type, which is real work with real value and is not a lint migration.
// biome-ignore-all lint/nursery/useExplicitReturnType: Same set as useExplicitType above: what remains are contextually-typed callbacks and factories whose inferred type is a tRPC router shape hundreds of characters wide.
// biome-ignore-all lint/nursery/useExplicitType: The 50 sites whose type the compiler could print are annotated. What is left is parameters of callbacks passed to third-party APIs -- Better Auth's hooks, tRPC's builders -- where the type is supplied contextually and writing it out means naming a library-internal type that will drift on the next upgrade.
// biome-ignore-all lint/performance/noAwaitInLoops: These sequential awaits are the point. Pacing a connector against a rate limit, walking Dokploy deployment records until one settles, and migrating SQL files in order all require the previous iteration to finish first; running them concurrently is the bug this rule would introduce.
// biome-ignore-all lint/performance/useTopLevelRegex: Worth doing, and not done here: hoisting these 45 literals is a real change to 22 files and belongs in its own commit where the diff is reviewable, not buried in a lint migration. Recorded rather than silently dropped.
// biome-ignore-all lint/style/noIncrementDecrement: `i += 1` is already the form used throughout; what remains is inside for-loop headers, where `i++` is the idiom the language reads best.
// biome-ignore-all lint/suspicious/useAwait: An async function with no await, because the port it implements returns a promise. The contract is the signature, not the body -- `.claude/rules/tests.md` and the ESLint config this replaced both called this out by name.

import { describe, expect, test as it } from "bun:test";
import { TestClock } from "./clock.ts";
import { HttpError } from "./errors.ts";
import { DEFAULT_RETRY, parseRetryAfter, withRetry } from "./retry.ts";

function noJitter(): number {
  return 0.999_999;
}

function attemptCounter(
  failures: number,
  status = 429,
): { readonly calls: number; run: () => Promise<string> } {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    run: async (): Promise<string> => {
      calls += 1;
      if (calls <= failures) {
        throw new HttpError(status, "https://example.test/x");
      }
      return "ok";
    },
  };
}

/**
 * Drive a retrying operation to completion on a `TestClock`, then report the outcome.
 *
 * Attaches a settlement handler to `promise` *before* advancing the clock. This is
 * load-bearing: a `withRetry` that exhausts its attempts rejects partway through the
 * advances, and a rejection with no handler yet attached is an unhandled rejection that
 * stalls the runner rather than failing the test. Capturing the outcome up front means
 * the assertion reads a value, never races one.
 */
async function drive<T>(
  clock: TestClock,
  promise: Promise<T>,
  steps: number,
  stepMs: number,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  const outcome = promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  for (let i = 0; i < steps; i++) {
    await clock.advance(stepMs);
  }
  return outcome;
}

describe("what retries and what does not", () => {
  it("retries a listed status and eventually succeeds", async () => {
    const clock = new TestClock();
    const op = attemptCounter(2);
    const result = withRetry(op.run, DEFAULT_RETRY, { clock, random: noJitter });
    for (let i = 0; i < 3; i++) {
      await clock.advance(60_000);
    }
    expect(await result).toBe("ok");
    expect(op.calls).toBe(3);
  });

  it("does not retry an unlisted status", async () => {
    // A 401 is not transient. Retrying turns a clear credential failure into a slow
    // one, and on some providers into a lockout.
    const op = attemptCounter(5, 401);
    await expect(withRetry(op.run, DEFAULT_RETRY, { clock: new TestClock() })).rejects.toThrow(
      /HTTP 401/u,
    );
    expect(op.calls).toBe(1);
  });

  it("gives up after the configured number of attempts", async () => {
    const clock = new TestClock();
    const op = attemptCounter(99);
    const result = withRetry(
      op.run,
      { ...DEFAULT_RETRY, attempts: 3 },
      { clock, random: noJitter },
    );
    const outcome = await drive(clock, result, 3, 60_000);
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.error).toBeInstanceOf(HttpError);
    expect(op.calls).toBe(3);
  });
});

describe("backoff", () => {
  it("grows exponentially and is capped", async () => {
    const clock = new TestClock();
    const delays: number[] = [];
    const op = attemptCounter(99);
    const result = withRetry(
      op.run,
      { ...DEFAULT_RETRY, attempts: 6, baseMs: 1000, maxMs: 4000, jitter: "none" },
      { clock, random: noJitter, onRetry: ({ delayMs }): number => delays.push(delayMs) },
    );
    const outcome = await drive(clock, result, 6, 10_000);
    expect(outcome.ok).toBe(false);
    expect(delays).toEqual([1000, 2000, 4000, 4000, 4000]);
  });

  it("full jitter scales the delay by the injected randomness", async () => {
    const clock = new TestClock();
    const delays: number[] = [];
    const op = attemptCounter(99);
    const result = withRetry(
      op.run,
      { ...DEFAULT_RETRY, attempts: 3, baseMs: 1000, jitter: "full" },
      { clock, random: (): number => 0.5, onRetry: ({ delayMs }): number => delays.push(delayMs) },
    );
    const outcome = await drive(clock, result, 3, 10_000);
    expect(outcome.ok).toBe(false);
    expect(delays).toEqual([500, 1000]);
  });
});

describe("Retry-After", () => {
  it.each([
    ["120", 120_000],
    ["0", 0],
    ["not-a-header", null],
    [null, null],
  ])("parses %p as %p", (header, expected) => {
    expect(parseRetryAfter(header, new Date("2026-01-01T00:00:00Z"))).toBe(expected as never);
  });

  it("parses an HTTP-date, which is equally legal", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:30 GMT", now)).toBe(30_000);
  });

  it("never returns a negative wait for a date already past", () => {
    const now = new Date("2026-01-01T00:01:00Z");
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:00 GMT", now)).toBe(0);
  });

  it("is honoured when the server asks", async () => {
    const clock = new TestClock();
    const delays: number[] = [];
    let calls = 0;
    async function op(): Promise<string> {
      calls += 1;
      if (calls === 1) {
        throw new HttpError(429, "https://example.test/x", "", 5000);
      }
      return "ok";
    }
    const result = withRetry(op, DEFAULT_RETRY, {
      clock,
      onRetry: ({ delayMs }): number => delays.push(delayMs),
    });
    await clock.advance(5000);
    expect(await result).toBe("ok");
    expect(delays).toEqual([5000]);
  });

  it("is clamped, so a hostile header cannot park a run for hours", async () => {
    const clock = new TestClock();
    const delays: number[] = [];
    let calls = 0;
    async function op(): Promise<string> {
      calls += 1;
      if (calls === 1) {
        throw new HttpError(429, "https://example.test/x", "", 86_400_000);
      }
      return "ok";
    }
    const result = withRetry(op, DEFAULT_RETRY, {
      clock,
      onRetry: ({ delayMs }): number => delays.push(delayMs),
    });
    await clock.advance(DEFAULT_RETRY.maxRetryAfterMs);
    expect(await result).toBe("ok");
    expect(delays).toEqual([DEFAULT_RETRY.maxRetryAfterMs]);
  });
});

// biome-ignore-all lint/style/noMagicNumbers: In a test the number IS the assertion. `expect(delayMs).toBe(5000)` says what the code must do; `expect(delayMs).toBe(EXPECTED_BACKOFF_MS)` says only that two names agree, and it can pass while both are wrong. Naming a fixture value also puts the expected result somewhere other than the line asserting it, which is the opposite of what .claude/rules/tests.md asks for. Source files get named constants; test files keep their literals.

// biome-ignore-all lint/correctness/useQwikValidLexicalScope: Qwik-domain rule about what may cross a `$()` serialization boundary. There is no Qwik in this repo.
// biome-ignore-all lint/nursery/noBunModules: Bun is the test runner, per CLAUDE.md: 'Bun is the runtime, package manager, workspace manager and test runner.' `bun:test` is the toolchain, not an accidental dependency.

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

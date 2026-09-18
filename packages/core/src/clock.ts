/**
 * Time as a port, so nothing in this repo has to actually wait.
 *
 * The connector runtime paces Xero at one request per 1.1 seconds and backs off
 * exponentially on a 429. Proving either against the real clock costs seconds per
 * assertion, so the tests get skipped, or shortened until they no longer describe
 * production, or made flaky by a loaded CI runner. All three end the same way: the
 * pacing is untested and a rate-limit storm is discovered in production.
 *
 * `p-queue` and `p-retry` both reach for real timers internally, which is why neither
 * is used here.
 */

export interface Clock {
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
}

export const systemClock: Clock = {
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

interface Sleeper {
  readonly dueAt: number;
  readonly resolve: () => void;
}

/** Yield to the macrotask queue, letting every pending continuation run. */
function drain(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/**
 * A clock that only moves when a test moves it.
 *
 * `advance()` is async because resolving a sleeper only queues its continuation;
 * awaiting a macrotask lets that continuation actually run before the test asserts.
 * Without it, `advance(1100)` returns while the paced call is still parked and the
 * assertion reads a stale world.
 */
export class TestClock implements Clock {
  #nowMs: number;
  #sleepers: Sleeper[] = [];

  constructor(start: Date = new Date("2026-01-01T00:00:00.000Z")) {
    this.#nowMs = start.getTime();
  }

  now(): Date {
    return new Date(this.#nowMs);
  }

  sleep(ms: number): Promise<void> {
    if (ms <= 0) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.#sleepers.push({ dueAt: this.#nowMs + ms, resolve });
    });
  }

  async advance(ms: number): Promise<void> {
    // Drain BEFORE moving time, not only after.
    //
    // A caller that is mid-`await` when `advance` is called has not registered its
    // sleep yet. Moving time first means that sleep is then created relative to the
    // *new* now, so `advance(5000)` for a caller about to sleep 5000ms produces a
    // deadline of 10000 that the advance it was waiting for can never reach. The
    // caller waits forever and the test hangs rather than failing.
    await drain();
    this.#nowMs += ms;

    // Loop, because a woken caller may immediately sleep again for a duration that is
    // already elapsed -- a retry whose backoff is shorter than the step just taken.
    for (let guard = 0; guard < 1000; guard++) {
      const due = this.#sleepers.filter((s) => s.dueAt <= this.#nowMs);
      if (due.length === 0) {
        return;
      }
      this.#sleepers = this.#sleepers.filter((s) => s.dueAt > this.#nowMs);
      for (const sleeper of due) {
        sleeper.resolve();
      }
      await drain();
    }
    throw new Error("TestClock.advance did not settle: a sleeper is rescheduling forever");
  }

  /** How many callers are parked. A pacer that never sleeps is not pacing. */
  get sleeping(): number {
    return this.#sleepers.length;
  }
}

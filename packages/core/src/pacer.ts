/**
 * Request pacing.
 *
 * Xero allows 60 calls a minute, 5,000 a day, and 5 concurrent per tenant. HubSpot
 * allows a burst per ten seconds. Exceeding either does not fail politely: it returns
 * 429s that then have to be backed off, so a run that tried to go faster finishes later
 * than one that paced itself.
 *
 * Pacing is driven by an injected `Clock`, which is the only reason proving 1.1-second
 * spacing costs microseconds instead of 1.1 seconds. A pacer tested against the real
 * clock gets shortened until it no longer describes production, or skipped.
 *
 * The daily cap is deliberately **not** waited out. Sleeping until midnight would park a
 * worker for hours while appearing to make progress; `QuotaExhausted` says what
 * happened and lets the schedule try again tomorrow.
 */

import { type Clock, systemClock } from "./clock.ts";
import { QuotaExhausted } from "./errors.ts";

export interface PacerOptions {
  /** Minimum gap between two requests. Xero: 1100. */
  readonly minIntervalMs?: number;
  readonly requestsPerMinute?: number;
  readonly requestsPerDay?: number;
}

export interface Pacer {
  /** Resolves when it is this caller's turn. */
  acquire: () => Promise<void>;
  /** How many requests this pacer has let through. */
  readonly granted: number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** The entries of a sliding window still inside `span`. */
function prune(window: number[], now: number, span: number): number[] {
  return window.filter((at) => now - at < span);
}

/**
 * The daily cap, which is the one limit that cannot be waited out within a run.
 *
 * Returns the pruned window, or raises. Separated from the per-minute pacing below because
 * the two answers are different in kind: one is "wait", the other is "come back tomorrow",
 * and sleeping on the second parks a worker for hours pretending to make progress.
 */
function admitDay(dayWindow: number[], now: number, requestsPerDay: number | undefined): number[] {
  if (requestsPerDay === undefined) {
    return dayWindow;
  }
  const pruned = prune(dayWindow, now, DAY_MS);
  if (pruned.length >= requestsPerDay) {
    throw new QuotaExhausted("daily request", requestsPerDay, new Date(pruned[0]! + DAY_MS));
  }
  return pruned;
}

interface TurnState {
  readonly now: number;
  readonly lastAt: number;
  readonly minIntervalMs: number;
  readonly minuteWindow: readonly number[];
  readonly requestsPerMinute?: number;
}

/**
 * How long before the next request may go: the longer of the minimum spacing and the wait
 * for the oldest entry to leave the per-minute window. Zero means now.
 */
function waitUntilTurn(state: TurnState): number {
  const { now, lastAt, minIntervalMs, minuteWindow, requestsPerMinute } = state;
  const waits: number[] = [];
  if (minIntervalMs > 0 && lastAt !== Number.NEGATIVE_INFINITY) {
    waits.push(lastAt + minIntervalMs - now);
  }
  if (requestsPerMinute !== undefined && minuteWindow.length >= requestsPerMinute) {
    waits.push(minuteWindow[0]! + MINUTE_MS - now);
  }
  return Math.max(0, ...waits);
}

export function createPacer(options: PacerOptions = {}, clock: Clock = systemClock): Pacer {
  const { minIntervalMs = 0, requestsPerMinute, requestsPerDay } = options;

  let lastAt = Number.NEGATIVE_INFINITY;
  let granted = 0;
  let minuteWindow: number[] = [];
  let dayWindow: number[] = [];
  // Serialises acquirers so two concurrent callers cannot both read `lastAt`, both
  // decide they may go now, and both go now.
  let queue: Promise<void> = Promise.resolve();

  async function waitTurn(): Promise<void> {
    for (;;) {
      const now = clock.now().getTime();

      dayWindow = admitDay(dayWindow, now, requestsPerDay);
      if (requestsPerMinute !== undefined) {
        minuteWindow = prune(minuteWindow, now, MINUTE_MS);
      }

      const wait = waitUntilTurn({
        now,
        lastAt,
        minIntervalMs,
        minuteWindow,
        ...(requestsPerMinute === undefined ? {} : { requestsPerMinute }),
      });
      if (wait <= 0) {
        lastAt = now;
        minuteWindow.push(now);
        dayWindow.push(now);
        granted += 1;
        return;
      }
      await clock.sleep(wait);
    }
  }

  return {
    acquire(): Promise<void> {
      const turn = queue.then(waitTurn);
      // Keep the chain alive after a rejection, or one QuotaExhausted would wedge
      // every later caller behind a permanently rejected promise.
      queue = turn.then(
        () => undefined,
        () => undefined,
      );
      return turn;
    },
    get granted(): number {
      return granted;
    },
  };
}

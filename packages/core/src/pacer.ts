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
  acquire(): Promise<void>;
  /** How many requests this pacer has let through. */
  readonly granted: number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export function createPacer(options: PacerOptions = {}, clock: Clock = systemClock): Pacer {
  const { minIntervalMs = 0, requestsPerMinute, requestsPerDay } = options;

  let lastAt = Number.NEGATIVE_INFINITY;
  let granted = 0;
  let minuteWindow: number[] = [];
  let dayWindow: number[] = [];
  // Serialises acquirers so two concurrent callers cannot both read `lastAt`, both
  // decide they may go now, and both go now.
  let queue: Promise<void> = Promise.resolve();

  function prune(window: number[], now: number, span: number): number[] {
    return window.filter((at) => now - at < span);
  }

  async function waitTurn(): Promise<void> {
    for (;;) {
      const now = clock.now().getTime();

      if (requestsPerDay !== undefined) {
        dayWindow = prune(dayWindow, now, DAY_MS);
        if (dayWindow.length >= requestsPerDay) {
          throw new QuotaExhausted(
            "daily request",
            requestsPerDay,
            new Date(dayWindow[0]! + DAY_MS),
          );
        }
      }

      const waits: number[] = [];
      if (minIntervalMs > 0 && lastAt !== Number.NEGATIVE_INFINITY) {
        waits.push(lastAt + minIntervalMs - now);
      }
      if (requestsPerMinute !== undefined) {
        minuteWindow = prune(minuteWindow, now, MINUTE_MS);
        if (minuteWindow.length >= requestsPerMinute) {
          waits.push(minuteWindow[0]! + MINUTE_MS - now);
        }
      }

      const wait = Math.max(0, ...waits);
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

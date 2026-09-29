/**
 * How much of a provider's day one run's whole reads may spend. ADR 0081.
 *
 * A whole read -- a first read, a changed request, a re-sync -- asks for every page of a list, and
 * on a large organisation that is most of a day's requests. The spec's `wholeReadBudget` says how
 * many of `rateLimit.requestsPerDay` whole reads may take; the rest is the reserve every "what
 * changed" read and every Run now is left. Once whole reads have spent their share, a list that
 * still has to be read whole waits for a run with room -- in practice the next day.
 *
 * THE PROVIDER'S OWN COUNT FIRST. Xero reports what the day has left in `X-DayLimit-Remaining` on
 * every answer, and that number already holds our retries, its own window -- fixed per
 * organisation and reset at a time nobody tells us -- and every other app reading the same
 * organisation. A count of our own could see none of those, so it is only the fallback for a
 * read that has not been told: this run's own whole-read requests, against the budget. Never
 * across runs: yesterday's count says nothing about a window we cannot see.
 *
 * One per run, shared by every entity, because the day is the organisation's and not a list's.
 */

import type { RequestBudget } from "@undercroft/connector-runtime";
import type { ConnectorSpec } from "@undercroft/contracts";

export interface DayBudget {
  /** The budget a whole read spends from: it refuses once the whole-read share is spent. */
  readonly whole: RequestBudget;
  /** For every other read: always admits, and keeps the provider's count current. */
  readonly watching: RequestBudget;
  /** Whether a whole read could make one more request now. Asked before one is started. */
  readonly hasRoom: () => boolean;
}

const COUNT = /^\d+$/u;

/** An integer header value, or `null` for one that is absent or is not a count. */
function countIn(headers: Readonly<Record<string, string>>, name: string): number | null {
  const text = headers[name];
  if (text === undefined || !COUNT.test(text.trim())) {
    return null;
  }
  return Number.parseInt(text, 10);
}

/**
 * The day's budget for this spec, or `null` when it declares none -- a source whose whole reads
 * are cheap enough never to be rationed, which is every source but Xero today.
 */
export function dayBudgetFor(spec: ConnectorSpec): DayBudget | null {
  const budget = spec.defaults.wholeReadBudget;
  const day = spec.defaults.rateLimit.requestsPerDay;
  if (budget === undefined || day === undefined) {
    return null;
  }
  // The spec schema holds the budget below the day, so the reserve is at least one request.
  const share = budget.requestsPerDay;
  const reserve = day - share;
  const header = budget.remainingHeader?.toLowerCase();
  let remaining: number | null = null;
  let spentWhole = 0;

  function hear(headers: Readonly<Record<string, string>>): void {
    const told = header === undefined ? null : countIn(headers, header);
    if (told !== null) {
      remaining = told;
    }
  }
  function hasRoom(): boolean {
    return remaining === null ? spentWhole < share : remaining > reserve;
  }

  return {
    whole: {
      admit: hasRoom,
      spent: (headers): void => {
        spentWhole += 1;
        hear(headers);
      },
    },
    watching: { admit: (): boolean => true, spent: hear },
    hasRoom,
  };
}

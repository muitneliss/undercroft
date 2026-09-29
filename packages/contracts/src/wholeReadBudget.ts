/**
 * A connector spec's daily budget for reading lists whole, and the one rule it must keep.
 *
 * Split from `connectorSpec.ts`, which had grown past what one file may be; the spec's schema
 * embeds `WholeReadBudget` under `defaults` and runs `wholeReadBudgetProblem` over every spec
 * it parses. ADR 0082.
 */

import { z } from "zod";

/**
 * How many of a day's requests reading lists WHOLE may spend -- a first read, a changed request,
 * or a re-sync (ADR 0082). The rest of the provider's `rateLimit.requestsPerDay` is the reserve
 * every "what changed" read and every Run now is left, so a day's re-sync never starves them.
 *
 * `remainingHeader` names the response header in which the provider reports how many requests
 * the day has left for the account. That is the count to trust over one of our own: it holds
 * retries, the provider's own window, and every other app reading the same account. A read that
 * never sees it falls back to counting its own requests against `requestsPerDay`.
 *
 * Its own object rather than a field of `rateLimit`, because `rateLimit` is also an entity's
 * override, and a day's budget per list would mean nothing.
 */
export const WholeReadBudget = z.object({
  requestsPerDay: z.number().int().positive(),
  remainingHeader: z.string().min(1).optional(),
});

/**
 * Why a whole-read budget cannot mean what it says, or `null`. It is a SHARE of the day's
 * requests, so there must be a day's requests to share, and it may not exceed them: a budget of
 * the whole day leaves no reserve, and one above it is a promise the provider will break.
 */
export function wholeReadBudgetProblem(defaults: {
  readonly rateLimit: { readonly requestsPerDay?: number | undefined };
  readonly wholeReadBudget?: { readonly requestsPerDay: number } | undefined;
}): string | null {
  const budget = defaults.wholeReadBudget;
  if (budget === undefined) {
    return null;
  }
  const day = defaults.rateLimit.requestsPerDay;
  if (day === undefined) {
    return "a wholeReadBudget is a share of rateLimit.requestsPerDay, which the spec does not declare";
  }
  return budget.requestsPerDay < day
    ? null
    : `wholeReadBudget.requestsPerDay must be below rateLimit.requestsPerDay (${String(day)}), leaving a reserve`;
}

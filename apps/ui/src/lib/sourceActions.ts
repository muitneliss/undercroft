/**
 * The mutations a source's card is acted on with, and which of them a given card is waiting on.
 *
 * Split from `routes/TenantOverview.tsx`, which owns the mutations and had grown past what one
 * file may be once a card could save a second schedule (ADR 0081).
 */

import type { GrantPending } from "@/components/ConnectionCard.tsx";
import type { trpc } from "@/trpc.ts";

/** The mutations a grant can be acted on with, held in one place so a card gets all of them. */
export interface Actions {
  readonly startOAuth: ReturnType<typeof trpc.connections.startOAuth.useMutation>;
  readonly disconnect: ReturnType<typeof trpc.connections.disconnect.useMutation>;
  readonly runNow: ReturnType<typeof trpc.runs.trigger.useMutation>;
  readonly setCadence: ReturnType<typeof trpc.connections.setCadence.useMutation>;
  readonly setResync: ReturnType<typeof trpc.connections.setResync.useMutation>;
}

/**
 * Which of `source`'s actions is in flight, read off the mutations' `variables` -- the request
 * each one was last called with -- so no second record of "what was clicked" exists to drift
 * from what was actually sent. A consent counts until the browser has left for it.
 *
 * `addAccount` separates the two consents that can name the same source: the first Gmail
 * account's card and the switcher's "add another" both send `gmail`, and only the one that
 * was pressed should say it is on its way to Google.
 */
export function pendingFor(
  actions: Actions,
  source: string,
  addAccount: boolean,
): GrantPending | null {
  const { startOAuth, disconnect, runNow, setCadence, setResync } = actions;
  const consent = startOAuth.isPending || startOAuth.isSuccess ? startOAuth.variables : undefined;
  if (consent?.source === source && (consent.addAccount === true) === addAccount) {
    return "connect";
  }
  if (disconnect.isPending && disconnect.variables.source === source) {
    return "disconnect";
  }
  if (runNow.isPending && runNow.variables.source === source) {
    return "run";
  }
  if (setCadence.isPending && setCadence.variables.source === source) {
    return "cadence";
  }
  if (setResync.isPending && setResync.variables.source === source) {
    return "resync";
  }
  return null;
}

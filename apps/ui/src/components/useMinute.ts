/**
 * The reader's clock, to the minute: what the title page's sky is drawn from (`@/lib/sky`).
 *
 * Nothing here holds a value of its own (`.claude/rules/state.md`): the minute is the browser's
 * clock, read through `useSyncExternalStore` rather than copied into a store or a state hook.
 * A minute is the grain the sky needs -- the sun moves along its course a step a minute, and the
 * light changes on the hour.
 */

import { useSyncExternalStore } from "react";

const MINUTE = 60_000;

function subscribeMinute(change: () => void): () => void {
  const id = setInterval(change, MINUTE);
  return (): void => {
    clearInterval(id);
  };
}

function currentMinute(): number {
  return Math.floor(Date.now() / MINUTE);
}

/** The current minute, as a date; the component re-renders when it turns. */
export function useMinute(): Date {
  return new Date(useSyncExternalStore(subscribeMinute, currentMinute) * MINUTE);
}

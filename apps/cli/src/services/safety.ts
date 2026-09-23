/**
 * Whether one invocation may go ahead: the CLI's whole mutation policy, in one decision.
 *
 * The server's role gates are the authority and apply unchanged -- a viewer cannot delete a
 * dashboard from here any more than from the browser. What this adds is a PERSON'S decision
 * per environment, because the caller may be an agent acting on text somebody else wrote: the
 * assistant reads the raw lake, and so can an agent driving this CLI. ADR 0044.
 *
 * In order, and the order is the policy:
 *
 * 1. A `write` or `destructive` command needs a named profile whose `allowWrites` a person
 *    set. Checked even for `--dry-run`, so a rehearsal answers the real question -- "would
 *    this go through here?" -- rather than one that is always yes.
 * 2. `--dry-run` then stops before any call. Nothing more is claimed for it: the server has no
 *    dry run, so "the server would accept this" is exactly what it cannot say.
 * 3. A `destructive` command needs `--yes` wherever nobody can be asked -- agent mode, or
 *    `--no-input`. A person at a terminal is asked instead.
 *
 * There is no idempotency key. The server offers none, and a key the CLI invented would be a
 * promise about retries that nothing behind it keeps.
 */

import type { Effect } from "../procedures.ts";

export type Decision =
  | { readonly verdict: "call" }
  | { readonly verdict: "dry-run" }
  | { readonly verdict: "ask" }
  | {
      readonly verdict: "refuse";
      readonly code: "WRITES_DISABLED" | "CONFIRMATION_REQUIRED";
      /**
       * The profile forbids writes, there is no named profile at all (a one-off URL), or a
       * destructive command was not confirmed. Each is worded differently to the caller.
       */
      readonly reason: "profile" | "one-off" | "unconfirmed";
    };

export function decide(input: {
  readonly effect: Effect;
  /** Whether a person can be asked -- `RuntimeMode.prompts`, false in agent mode. */
  readonly canAsk: boolean;
  readonly profile: string | null;
  readonly allowWrites: boolean;
  readonly yes: boolean;
  readonly dryRun: boolean;
}): Decision {
  if (input.effect !== "read" && !input.allowWrites) {
    return {
      verdict: "refuse",
      code: "WRITES_DISABLED",
      reason: input.profile === null ? "one-off" : "profile",
    };
  }
  if (input.dryRun) {
    return { verdict: "dry-run" };
  }
  if (input.effect === "destructive" && !input.yes) {
    return input.canAsk
      ? { verdict: "ask" }
      : { verdict: "refuse", code: "CONFIRMATION_REQUIRED", reason: "unconfirmed" };
  }
  return { verdict: "call" };
}

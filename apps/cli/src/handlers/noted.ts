/**
 * What a handler answers with: the one outcome of the run, and how a person should read it.
 *
 * `main.ts` renders it -- the envelope in agent mode, and in human mode the `note`, a table
 * of the data, or the erratum. `drawn` is for the handlers that write what a person reads
 * themselves (a page, or a prompt rail that ends on its own last line), so nothing is said
 * twice.
 */

import type { Outcome } from "../services/output.ts";

/** A success a person reads as a sentence; the envelope an agent reads is unchanged. */
export interface Noted {
  readonly outcome: Outcome;
  readonly note?: string;
  /**
   * The handler has already written everything a person reads, so `main.ts` adds nothing in
   * human mode. Agent mode still gets the envelope; nothing that sets this runs there.
   */
  readonly drawn?: true;
}

export function noted(outcome: Outcome, note?: string): Noted {
  return note === undefined ? { outcome } : { outcome, note };
}

export function drawn(outcome: Outcome): Noted {
  return { outcome, drawn: true };
}

/**
 * One record of the lists a spec run did not read for want of a scope, however that was found.
 *
 * Split from `grant.ts`, which decides whether a recorded grant can read a source before asking;
 * this is what a run does with the answer, and with the source's own answer when no grant was
 * recorded (ADR 0073, ADR 0075).
 */

import type { UngrantedRead } from "@undercroft/contracts";

import { GrantTooNarrow } from "./grant.ts";
import type { RunJournal } from "./runJournal.ts";

/**
 * The lists a spec run did not read because the grant does not reach them, and the scope each
 * lacks -- one record of it, whichever way it was found out.
 *
 * A recorded grant is judged before the first request (`partitionByGrant`, ADR 0073), and the run
 * opens with those lists. A grant that was never recorded -- a HubSpot private-app token -- is
 * judged by the source on a list's first request, and the runtime raises `EntityNotGranted` only
 * when the source's answer says so in so many words (ADR 0075). Either way the list gets one
 * `entity_not_granted` warning naming the scope, because the reader's question is which lists and
 * what granting would add, and the Journal words it.
 *
 * Nothing goes into the ledger's entities: a list refused on its first request landed nothing,
 * and a row saying `0` would read as a list the source answered empty. The run otherwise goes on,
 * because the grant still reads every other list, and a run that failed on their account would
 * lose them too.
 */
export class NotGranted {
  readonly #scopes = new Map<string, string>();
  readonly #journal: RunJournal;

  constructor(journal: RunJournal, before: readonly UngrantedRead[]) {
    this.#journal = journal;
    for (const { entity, scope } of before) {
      this.record(entity, scope);
    }
  }

  record(entity: string, scope: string): void {
    this.#scopes.set(entity, scope);
    this.#journal.warn("entity_not_granted", { entity, scope });
  }

  /** The scope the entity was refused for, or `undefined` when it was not refused. */
  scopeOf(entity: string): string | undefined {
    return this.#scopes.get(entity);
  }

  /**
   * Refuse a run that read nothing, when that is because nothing was granted: "no list was
   * readable" is not a success, and the error names the scopes granting would add.
   */
  refuseWhenNothingRead(input: { source: string; tenantId: string }, read: number): void {
    if (read === 0 && this.#scopes.size > 0) {
      const scopes = [...new Set(this.#scopes.values())].join(", ");
      throw new GrantTooNarrow(input.source, input.tenantId, scopes);
    }
  }
}

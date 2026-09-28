/**
 * Which reads may say what the source holds, and what they say: every id it listed.
 *
 * A spec entity with `removedWhen: absent` asks the caller to mark removed any record it holds
 * that a complete read no longer names (ADR 0071). The inference is only as good as the word
 * "complete", and a wrong answer here is the worst kind this codebase has: a live record shown
 * as deleted, every one of them at once, with a green run. So this module answers with the ids
 * or with `null`, never with a partial set, and every doubt is a `null`.
 *
 * A listing is collected only when:
 *
 * - the entity declares `removedWhen: absent` on a `list` request -- nothing else pays for
 *   holding the ids, which is the memory a streaming read gave up on purpose (ADR 0033);
 * - the SOURCE is asked for all of it. A `client-filter` watermark does not narrow the listing,
 *   it pages the whole source and only skips landing what has not changed, so the id of every
 *   skipped record is in the set -- the rule Drive's `seenIds` learned the hard way, since
 *   leaving an unchanged record out of the set would report it removed. A `header` or
 *   `query-param` watermark does narrow it, and such a read says nothing
 *   (`incremental.ts`'s `asksSourceForLess`).
 *
 * And it is only handed over when the read is OVER, by the generator's return value, so a read
 * that threw, or that its caller stopped, never produces one. `run.ts` also withholds it when
 * `maxRecords` truncated the read. What is left to refuse is the empty listing: a source that
 * answers "nothing" to a read that asked for everything is far likelier to be a credential or a
 * provider fault than a portal whose every record was deleted, and the price of guessing wrong
 * is the whole lake marked removed. `failOnEmpty` says the same on a first read; this says it on
 * every read, because it decides something every read.
 */

import type { ConnectorEntity } from "@undercroft/contracts";

import { asksSourceForLess } from "./incremental.ts";

/** Whether this read, got to the end, names every live record the source holds. */
function listsWholeSource(entity: ConnectorEntity, since: string | null): boolean {
  return (
    entity.removedWhen === "absent" &&
    entity.request.kind === "list" &&
    !asksSourceForLess(entity, since)
  );
}

/**
 * A set to put every id the source names in, or `null` when nobody will read one.
 *
 * Two readers want it. A listing, above. And a `batch-from` relation reading against this entity
 * (`keepIds`), which asks about every record the read NAMED rather than only the ones it landed:
 * a record a client filter skipped as unchanged still has links, and a relation added to a spec
 * after its parent's watermark was set would otherwise only ever learn the links of records that
 * changed since (ADR 0074). What the relation is handed is only ever what the read named, so a
 * watermark sent to the source still narrows it, exactly as before.
 */
export function startNaming(
  entity: ConnectorEntity,
  since: string | null,
  keepIds: boolean,
): Set<string> | null {
  return keepIds || listsWholeSource(entity, since) ? new Set() : null;
}

/** What a read that listed to the end may say. See the module docstring for the empty case. */
export function finishListing(
  entity: ConnectorEntity,
  since: string | null,
  named: ReadonlySet<string> | null,
): ReadonlySet<string> | null {
  return named === null || named.size === 0 || !listsWholeSource(entity, since) ? null : named;
}

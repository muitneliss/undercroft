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

/** A set to put every listed id in, or `null` when this read could never say what the source holds. */
export function startListing(entity: ConnectorEntity, since: string | null): Set<string> | null {
  const collects =
    entity.removedWhen === "absent" &&
    entity.request.kind === "list" &&
    !asksSourceForLess(entity, since);
  return collects ? new Set() : null;
}

/** What a read that listed to the end may say. See the module docstring for the empty case. */
export function finishListing(listing: Set<string> | null): ReadonlySet<string> | null {
  return listing === null || listing.size === 0 ? null : listing;
}

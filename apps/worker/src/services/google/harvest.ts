/**
 * What a Google harvest streams, and what it is allowed not to read at all.
 *
 * Gmail and Drive collect different things from different shapes of API, but they answer
 * the same caller with the same stream, so this is the contract between them and
 * `collect.ts` -- and it lives here rather than in either collector because both of them
 * import it and `collect.ts` imports both.
 *
 * ## A harvest is a stream, and its summary is its RETURN value
 *
 * Both collectors used to read a whole source into two arrays and hand them back. On
 * 2026-09-21 that reached the worker's 1 GiB cgroup limit 76 minutes into a mailbox of
 * 7,786 messages and lost every byte it had read. An {@link Harvest} yields one source
 * object at a time and holds nothing, so the worker's memory is flat in the size of the
 * mailbox.
 *
 * What is only true once the whole source has been walked -- which files were seen, which
 * picks yielded nothing -- is the generator's RETURN value rather than a second output
 * parameter. `AsyncGenerator<T, R>` is already how `connector-runtime` carries "did
 * `maxRecords` stop this read" back out of `readPages`; a side channel would be a second
 * place for the same answer to live.
 *
 * ## A record's documents are landed BEFORE the record, and the record then says how many
 *
 * {@link HarvestItem} pairs them for exactly that reason: a message whose record landed while
 * its attachment fetch was still failing would be skipped on every future run, and the
 * attachment would be lost from the one layer that cannot be recomputed. `collect.ts` holds a
 * record back until its documents are down, and a crash between the two merely re-does the
 * message, which is idempotent by content.
 *
 * That ordering made "present in `raw.records`" mean "fully harvested" for every row it wrote
 * -- and for no other row. ADR 0035 is what happened next: the rows written by the OLD order,
 * records first and documents last, were skipped on presence by every run after the fix, so a
 * mailbox of 7,786 messages kept zero attachments and could not recover on its own. The claim
 * is now carried rather than assumed. `collect.ts` counts what the sink got down and the
 * record is marked with it; {@link AlreadyHeld} answers on the mark, not on the row.
 *
 * The other half of the same rule is that a document refused for its declared SIZE does not
 * hold its record back and is not counted in the mark. That refusal is deterministic -- it
 * will refuse identically forever -- so waiting on it would make the message unharvestable,
 * and counting it would make the message perpetually incomplete. Both lose the same mailbox.
 */

import type { SqlExecutor } from "@undercroft/db";

import { knownRecords, type RecordProbe, type StreamIdentity } from "../../repos/rawRecords.ts";
import type { DocumentToLand } from "../landDocument.ts";
import type { RecordToLand } from "../land.ts";

export type { RecordProbe } from "../../repos/rawRecords.ts";

/** One source object, with every document that belongs to it. */
export interface HarvestItem {
  readonly record: RecordToLand;
  /** Landed before {@link HarvestItem.record} is. See the module docstring. */
  readonly documents: readonly DocumentToLand[];
}

/**
 * What was picked and not taken, with why.
 *
 * Recorded rather than dropped: "we were given nothing" and "we refused what we were given"
 * are different facts and used to be the same green run landing 0. CLAUDE.md rule 2.
 */
export interface PickSkipped {
  readonly fileId: string;
  readonly reason: string;
}

/** What is only true once a whole source has been walked. */
export interface HarvestSummary {
  /**
   * Every document id this run saw, so the caller can tombstone what vanished -- INCLUDING
   * the ones it skipped because they had not changed.
   *
   * Null for Gmail, deliberately: a message that stops matching a label selection has been
   * relabelled, not deleted, and the tombstone pass must not be handed a set that would
   * report a deletion which never happened.
   */
  readonly seenIds: readonly string[] | null;
  readonly skipped: readonly PickSkipped[];
  /** How many source objects the listing named, before anything was skipped. */
  readonly listed: number;
  /** How many of those were already held and so were never fetched. */
  readonly known: number;
}

/** The one shape both collectors answer with. */
export type Harvest = AsyncGenerator<HarvestItem, HarvestSummary>;

/**
 * Which of these a run already holds, and so does not need to read again.
 *
 * A function rather than an executor, so a collector needs to know neither which tenant it
 * is running for nor that `raw.records` exists -- it asks what it may skip and is told. The
 * `deps`-as-functions idiom `layering.md` already asks for.
 */
export type AlreadyHeld = (probes: readonly RecordProbe[]) => Promise<ReadonlySet<string>>;

/**
 * The binding every real run uses: what this stream has in `raw.records` AND has marked
 * harvest-complete. A row whose landing never said what it settled is not held. ADR 0035.
 */
export function heldBy(exec: SqlExecutor, identity: StreamIdentity): AlreadyHeld {
  return (probes): Promise<ReadonlySet<string>> => knownRecords(exec, identity, probes);
}

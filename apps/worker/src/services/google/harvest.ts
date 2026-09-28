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
 *
 * ## Held is not the same as finished with, for a record whose documents were CHOSEN
 *
 * A mark says what a harvest settled under the file-type choice of its day. Widen the choice --
 * or ship a catalogue that admits a new spelling of a chosen type -- and a held message may
 * carry an attachment that is now wanted and was never landed, which skipping the message whole
 * would lose for good while every run reported success (#292). So a Gmail mark also records
 * what its harvest LEFT BEHIND, described by type, extension and size and never by name
 * ({@link LeftBehindDocument}), and {@link AlreadyHeld} hands that list back. The collector asks
 * the current choice about it and reads the message again only when something on it is now
 * allowed and under the ceiling -- a {@link HarvestItem.reread}. ADR 0076.
 */

import type { SqlExecutor } from "@undercroft/db";

import {
  type HeldRecord,
  knownRecords,
  type RecordProbe,
  type StreamIdentity,
  type LeftBehindDocument,
  storedDigests,
} from "../../repos/rawRecords.ts";
import type { DocumentToLand } from "../landDocument.ts";
import type { RecordToLand } from "../land.ts";

export type { HeldRecord, RecordProbe, LeftBehindDocument } from "../../repos/rawRecords.ts";

/** One source object, with every document that belongs to it. */
export interface HarvestItem {
  readonly record: RecordToLand;
  /** Landed before {@link HarvestItem.record} is. See the module docstring. */
  readonly documents: readonly DocumentToLand[];
  /**
   * What this harvest saw on the record and did not offer or could not land, to be recorded
   * on the mark so a wider choice can find it later. Absent for a collector that keeps no such
   * list -- Drive, where a file that is not chosen is never listed at all.
   */
  readonly leftBehind?: readonly LeftBehindDocument[];
  /**
   * Present when the record was already HELD and is read again because something it left
   * behind may now land (ADR 0076). `documentsLanded` is what the earlier harvests already got
   * down and this one does not offer again, so the mark is that plus what lands now; it is `0`
   * for a record whose earlier harvest never said what it left behind, which offers everything.
   */
  readonly reread?: { readonly documentsLanded: number };
  /**
   * The record alone is to land: nothing of its documents is offered or settled this run, so
   * the mark stays as the earlier harvest left it. A Drive file whose bytes are held and whose
   * record changed -- it moved -- and a Drive folder, which has no documents at all. ADR 0078.
   */
  readonly recordOnly?: true;
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
   * Every id this run's listing named, by entity, so the caller can settle what vanished --
   * INCLUDING the ones it skipped because they had not changed. The record entity's ids are
   * its documents' ids too, since a Drive file IS its document, so one set decides both
   * `raw.records` and `raw.documents` and the two cannot disagree. ADR 0071, ADR 0078.
   *
   * Null for Gmail, deliberately: a message that stops matching a label selection has been
   * relabelled, not deleted, and the removal pass must not be handed a set that would
   * report a deletion which never happened.
   */
  readonly listings: ReadonlyMap<string, readonly string[]> | null;
  readonly skipped: readonly PickSkipped[];
  /** How many source objects the listing named, before anything was skipped. */
  readonly listed: number;
  /**
   * How many of those were already held and so were never fetched. A held record read again
   * (a {@link HarvestItem.reread}) is not among them: it was fetched.
   */
  readonly known: number;
}

/** The one shape both collectors answer with. */
export type Harvest = AsyncGenerator<HarvestItem, HarvestSummary>;

/**
 * Which of these a run already holds, and what each one's harvest settled.
 *
 * A function rather than an executor, so a collector needs to know neither which tenant it
 * is running for nor that `raw.records` exists -- it asks what it may skip and is told. The
 * `deps`-as-functions idiom `layering.md` already asks for. An id absent from the answer is
 * not held and is read; what a collector does with a held one is its own decision, which for
 * Drive is always "skip" and for Gmail turns on what the record left behind.
 */
export type AlreadyHeld = (
  probes: readonly RecordProbe[],
) => Promise<ReadonlyMap<string, HeldRecord>>;

/**
 * The binding every real run uses: what this stream has in `raw.records` AND has marked
 * harvest-complete. A row whose landing never said what it settled is not held. ADR 0035.
 */
export function heldBy(exec: SqlExecutor, identity: StreamIdentity): AlreadyHeld {
  return (probes): Promise<ReadonlyMap<string, HeldRecord>> => knownRecords(exec, identity, probes);
}

/**
 * The content digest this source holds for each of these ids of one entity, live rows only.
 *
 * The record-level question beside {@link AlreadyHeld}'s byte-level one: a collector that
 * lists its whole source every run lands a record again only when the record it would land
 * hashes differently from the one held. Keyed by entity because one Drive walk lands two.
 */
export type StoredDigests = (
  entity: string,
  ids: readonly string[],
) => Promise<ReadonlyMap<string, string>>;

/** The binding every real run uses. */
export function digestsBy(
  exec: SqlExecutor,
  scoped: { source: string; tenantId: string },
): StoredDigests {
  return (entity, ids): Promise<ReadonlyMap<string, string>> =>
    storedDigests(exec, { ...scoped, entity }, ids);
}

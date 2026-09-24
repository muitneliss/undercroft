/**
 * Landing a source in bounded chunks, so the worker's memory is flat in its size.
 *
 * Every ingest path used to read a source COMPLETELY into memory and then land it: an array
 * of every record, and then an array of a result per record. On 2026-09-21 a Gmail ingest of
 * 7,786 messages reached the worker's own 1 GiB cgroup limit and was oom-killed 76 minutes
 * in, losing every byte it had read. Nothing was wrong with the mailbox. The shape of the
 * code was the fault, and it was the same shape in all three paths.
 *
 * A sink is what replaces that shape. A caller adds one record at a time and never holds the
 * source; the sink holds at most {@link CHUNK} of them and a handful of counters, whatever
 * the source's size. `close` answers with the counters alone -- there is deliberately no
 * array of results to return, because that array is the other half of what blew the heap.
 *
 * ## What this file is, and what is beside it
 *
 * This file is the CONTRACT: what a sink promises, what it counts, and the ordering rule the
 * two sinks hold between them. The two implementations are `recordSink.ts` and
 * `documentSink.ts`, which mirror the pair one layer below them (`land.ts` and
 * `landDocument.ts`) so a reader can guess where a thing lives. The argument stays here rather
 * than being halved between them, because most of it is about the relationship: a document
 * sink's `flush` exists for a record sink's caller, and neither half is a reason on its own.
 *
 * ## Four things this contract is responsible for
 *
 * **The chunk is the only thing held.** `landRecords` and `landDocuments` already land one
 * record at a time and already isolate a per-record failure, so a chunk is not a transaction
 * and a crash mid-chunk loses nothing that reached the lake. What the chunk bounds is the
 * `results` array those functions build: it is consumed into counters and dropped before the
 * next chunk is read. Neither signature changed for this -- the fix was never in them.
 *
 * **Refusals are written as they happen.** They used to accumulate in `Ledger.refusals`
 * until the run settled, which is unbounded memory AND the reason a run that died left no
 * evidence of what it had already refused. A refusal is a statement about the data, so
 * failing to record one fails the run rather than being swallowed the way the journal's
 * narration is -- a refused row recorded nowhere is the silent drop CLAUDE.md rule 2 exists
 * to forbid.
 *
 * **A document is catalogued in the iteration that landed it.** The catalogue row needs both
 * the document (its content type and metadata) and the landing result (its lake key, digest
 * and size), and the old code re-joined the two afterwards with a `find` inside a loop over
 * every result -- quadratic in the size of the mailbox. Pairing them inside the chunk that
 * produced them makes the join O(chunk) and removes the need for either whole array.
 *
 * **A document sink can be told to land NOW, and answers for everything since the last time.**
 * `flush` is the one thing a caller may ask a sink to do out of turn, and it exists because
 * one caller has an ordering rule the sink cannot see: a Gmail message's record must not reach
 * `raw.records` before its attachment reaches the lake, or the next run reads the record as
 * "fully harvested" and skips the message forever with its attachment never fetched.
 *
 * What it answers for is every document added since the previous `flush`, INCLUDING the ones a
 * full buffer landed on its own in between. That is not a nicety. A sink that reported only
 * the chunk `flush` itself landed reported nothing at all whenever `add` had just tripped the
 * chunk boundary -- which on a mailbox of one attachment per message is precisely when the
 * caller asks -- and every record in that batch landed however its attachment had fared. The
 * outcome is accumulated by the sink instead, because only the sink knows what it landed when
 * nobody was asking.
 *
 * A FETCH THAT FAILED IS `unfetched`; A SIZE REFUSAL IS NEITHER `landed` NOR `unfetched`. A
 * failed fetch can succeed next run, so whatever waited on it must wait another run. A
 * document refused for its declared size will be refused identically forever, so a record held
 * back for one would never land at all -- and a record that COUNTED it would be re-fetched
 * forever instead. It settles as zero landed documents, which is the truth.
 *
 * ## Why a record sink projects into `raw.records`, per chunk
 *
 * Because that is what makes a killed run resumable. What the next run skips is what
 * `raw.records` holds, so a run that projected only at the end of an entity and died at
 * minute 70 would leave 7,786 objects in the lake and nothing to skip -- and the run after it
 * would fetch the whole mailbox again, which is the loss this whole change exists to stop.
 * Per chunk, a crash costs one chunk in both layers rather than an entity in one of them.
 *
 * The FIRST chunk's projection is also the recovery step, by construction: `loadStreamToRaw`
 * resumes from `raw.load_cursor`, so it picks up whatever a previous dead run landed and
 * never projected. That is why there is no separate catch-up call at the start of a run --
 * one would repair the previous crash while setting the current run up for the same loss.
 *
 * An earlier draft of this module refused to project here, and it was right at the time: a
 * pass then re-listed the stream's entire journal and cost a LIST and two manifest reads per
 * record. It now scans from the load cursor (`ObjectStore.list`'s `startAfter`, the use the
 * key layout was designed for) and reads an observation in one call, so the pass after a
 * chunk costs that chunk.
 *
 * A projection that fails fails the run, for the same reason a refusal that cannot be
 * recorded does: a chunk that is in the lake and not in `raw.records` is exactly what the
 * next run silently re-fetches.
 *
 * ## A run told to stop keeps what it landed, and counts it
 *
 * Per-chunk projection makes a KILLED run resumable; it does not make one counted, because the
 * counters live in this process and die with it. A deploy is the common kill, and it is not a
 * kill unless the process ignores the SIGTERM before it. So a run told to stop (`RunDeps.stop`,
 * ADR 0051) closes its record sink -- which holds only records whose documents are already
 * down, so it lands in seconds -- and ABANDONS its document sink's buffer rather than landing
 * it, which could take minutes of paced fetches. The two summaries then go into the run's
 * ledger, and the counts on a stopped run are what reached the lake rather than zeroes.
 */

import type { SqlExecutor } from "@undercroft/db";
import { recordRefusals, type RunRefusal } from "@undercroft/db/repos";
import type { LakeStore } from "@undercroft/lake";

import type { RecordToLand } from "./land.ts";
import type { DocumentToLand } from "./landDocument.ts";

/**
 * How many records a sink holds before it lands them.
 *
 * Not a transaction size and not a tuning knob for throughput: every lake write is its own
 * create-only call either way. It is the size of the only structure that would otherwise
 * grow with the source, and for documents it is also how many catalogue rows one `unnest`
 * statement carries. Two hundred records of a few kilobytes is a few hundred kilobytes held
 * at the peak, which is flat whether the mailbox has 200 messages or 200,000.
 */
export const CHUNK = 200;

/**
 * Where a sink's refusals go.
 *
 * Injected rather than reached for, because `ops.run_refusal` references `ops.run(id)`: that
 * a run row exists is a fact about the CALLER, not about landing. A caller driving a
 * collector with no ledger behind it -- the case `SILENT_JOURNAL` exists for on the
 * narration side -- can say where its refusals go instead of being unable to use a sink.
 *
 * Called once per chunk, with nothing to say more often than not, so an implementation
 * answers an empty list cheaply rather than making the sink check first.
 */
export type RefusalWriter = (refusals: readonly RunRefusal[]) => Promise<void>;

/** Refusals into the ledger of a run that has a row. The binding every real run uses. */
export function refusalsToRun(exec: SqlExecutor, runId: string): RefusalWriter {
  return (refusals): Promise<void> => recordRefusals(exec, runId, refusals);
}

/** Who is landing, and under which run. An entity is a property of each record, not of this. */
export interface Landing {
  readonly source: string;
  readonly tenantId: string;
  readonly runId: string;
}

/** A document landing also stamps its catalogue rows, which records do not have. */
export interface DocumentLanding extends Landing {
  readonly observedAt: string;
}

/**
 * A sink writes to both durable layers, so it holds the executor as well as the lake: a
 * record sink projects each chunk it lands, and a document sink catalogues each one.
 */
export interface SinkDeps {
  readonly lake: LakeStore;
  readonly exec: SqlExecutor;
  readonly refuse: RefusalWriter;
}

/** What the per-chunk projections wrote into `raw.records`, summed over every chunk. */
export interface LoadedCounts {
  readonly created: number;
  readonly changed: number;
  readonly unchanged: number;
}

/** What a record sink counted. Counters only: the per-record results are gone by now. */
export interface LandSummary {
  /** Reached the lake, new or unchanged. What the ledger calls `landed`. */
  readonly landed: number;
  readonly created: number;
  readonly unchanged: number;
  /** Refused with a reason, already written through the {@link RefusalWriter}. */
  readonly refused: number;
  /**
   * What the projection did, ACCUMULATED across the chunks rather than taken from the last.
   *
   * The counts exist here because the projection now runs inside the sink, so the caller
   * that used to hold `loadStreamToRaw`'s result no longer sees one -- and a run reporting
   * `created: 0` because nobody carried the number back is indistinguishable from a run
   * that genuinely created nothing. A per-chunk number would be worse than none: on a
   * mailbox of 7,786 it would report whatever the last 200 did.
   */
  readonly loaded: LoadedCounts;
}

/** What a document sink counted. `skipped` and `failed` are both refusals, with two reasons. */
export interface DocumentSummary {
  readonly landed: number;
  readonly created: number;
  readonly unchanged: number;
  /** Refused before its bytes were fetched -- over the size ceiling. */
  readonly skipped: number;
  readonly failed: number;
}

/**
 * A record to land, with what its harvest settled beside it.
 *
 * `documentsLanded` is how many of this record's documents reached the lake AND the catalogue
 * -- which is what the NEXT run reads as "this message is finished, skip it". It is recorded
 * rather than inferred because inferring it is what failed: ADR 0033 asserted that a row in
 * `raw.records` meant a finished harvest, and the assertion bound only the rows written after
 * it. ADR 0035, and `230_documents_landed.sql` for the column.
 *
 * ABSENT MEANS THE CALLER HAS NO DOCUMENTS TO SETTLE -- the spec path and the lake REST API,
 * neither of which has a document channel at all. Nothing is marked for them, so nothing
 * claims their rows are complete. It is optional rather than a required `0` so that the two
 * callers with nothing to say are not made to say it: a required field they would fill with a
 * constant is a field the next caller fills with a constant too, and this column exists
 * because a constant claim of completeness went unchecked once already.
 */
export interface HarvestedRecord extends RecordToLand {
  readonly documentsLanded?: number;
}

export interface RecordSink {
  add: (record: HarvestedRecord) => Promise<void>;
  close: () => Promise<LandSummary>;
}

/**
 * What became of the documents a sink has been given since it was last asked.
 *
 * Two sets rather than one list because three answers are possible and only two of them are
 * these: landed, failed-and-retryable, and refused for a declared size -- which is in neither,
 * deliberately. See {@link DocumentSink.flush}.
 */
export interface DocumentOutcome {
  /** Bytes in the lake and a row in `raw.documents`. */
  readonly landed: ReadonlySet<string>;
  /** Refused and RETRYABLE: the fetch may succeed on a later run. */
  readonly unfetched: ReadonlySet<string>;
}

export interface DocumentSink {
  add: (document: DocumentToLand) => Promise<void>;
  /**
   * Land what is held now, and answer for every document added since the last `flush`.
   *
   * For the caller that has to land something else only once a document is safely down, and
   * has to say how many got down. The Google collectors are that caller: a message's record
   * must not reach `raw.records` before its attachment reaches the lake, because that row is
   * what the next run reads as "fully harvested" and skips. A record that outran its
   * attachment is therefore an attachment lost for good -- CLAUDE.md rule 2 broken by the
   * resume mechanism itself.
   *
   * SINCE THE LAST FLUSH, not since this call, and the module docstring says why: a full
   * buffer lands on its own inside `add`, and an answer scoped to this call's chunk is silent
   * about exactly those documents.
   *
   * {@link RecordSink} has no counterpart on purpose: the ordering rule points one way, and
   * nothing needs a record chunk forced out early.
   */
  flush: () => Promise<DocumentOutcome>;
  close: () => Promise<DocumentSummary>;
  /**
   * Close WITHOUT landing what is held, and answer for what already landed.
   *
   * For a run the process has told to stop (`RunDeps.stop`). What is held is the documents of
   * records that have not been released yet -- a buffer of up to a chunk of attachments whose
   * bytes are not fetched, which at Gmail's paced rate is minutes the container's stop grace
   * period does not have. Nothing is lost by leaving them: their records are held back too, so
   * nothing in `raw.records` claims them, and the next run reads those messages again and
   * lands both halves. `close` would be the wrong call precisely because it is thorough.
   *
   * The counts are only what reached the lake, which is what makes them safe to record on the
   * run. Synchronous, because there is nothing left to wait for.
   */
  abandon: () => DocumentSummary;
}

/** Refused after a sink was closed: a record added now would never be landed by anyone. */
export class SinkClosed extends Error {
  constructor() {
    super("this sink is closed; nothing added now would be landed");
    this.name = "SinkClosed";
  }
}

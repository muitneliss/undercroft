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
 * ## Three things this file is responsible for
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
 */

import type { SqlExecutor } from "@undercroft/db";
import { recordRefusals, type RunRefusal } from "@undercroft/db/repos";
import type { LakeStore } from "@undercroft/lake";

import { type RawDocumentRow, upsertDocuments } from "../repos/rawDocuments.ts";
import { landRecords, type RecordToLand } from "./land.ts";
import { type DocumentToLand, type LandedDocument, landDocuments } from "./landDocument.ts";
import { loadStreamToRaw } from "./loadToRaw.ts";

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

/** The entity a refused document is filed under. Documents are their own entity in the ledger. */
const DOCUMENT_ENTITY = "documents";

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

/** What a record sink counted. Counters only: the per-record results are gone by now. */
export interface LandSummary {
  /** Reached the lake, new or unchanged. What the ledger calls `landed`. */
  readonly landed: number;
  readonly created: number;
  readonly unchanged: number;
  /** Refused with a reason, already written through the {@link RefusalWriter}. */
  readonly refused: number;
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

export interface RecordSink {
  add: (record: RecordToLand) => Promise<void>;
  close: () => Promise<LandSummary>;
}

export interface DocumentSink {
  add: (document: DocumentToLand) => Promise<void>;
  close: () => Promise<DocumentSummary>;
}

/** Refused after a sink was closed: a record added now would never be landed by anyone. */
class SinkClosed extends Error {
  constructor() {
    super("this sink is closed; everything added before close() was landed");
    this.name = "SinkClosed";
  }
}

export function createRecordSink(deps: SinkDeps, at: Landing, chunk: number = CHUNK): RecordSink {
  const buffer: RecordToLand[] = [];
  let created = 0;
  let unchanged = 0;
  let refused = 0;
  let closed = false;

  async function flush(): Promise<void> {
    if (buffer.length === 0) {
      return;
    }
    // `splice` empties the buffer as it hands the chunk over, so the sink is already back to
    // holding nothing while this chunk is being landed.
    const chunkOf = buffer.splice(0);
    const result = await landRecords(deps.lake, {
      source: at.source,
      tenantId: at.tenantId,
      runId: at.runId,
      records: chunkOf,
    });
    created += result.created;
    unchanged += result.unchanged;
    refused += result.failed;

    const refusals: RunRefusal[] = [];
    for (const landed of result.results) {
      if (landed.status === "failed") {
        refusals.push({
          entity: landed.entity,
          sourceRecordId: landed.sourceRecordId,
          reason: landed.reason ?? "refused",
        });
      }
    }
    await deps.refuse(refusals);

    // The evidence is written before the projection, because the projection is the part that
    // can fail on something other than this chunk. A stream per entity present, since an
    // entity is a property of a record rather than of the sink -- ordinarily one.
    for (const entity of new Set(chunkOf.map((record) => record.entity))) {
      await loadStreamToRaw(deps.exec, deps.lake, {
        source: at.source,
        tenantId: at.tenantId,
        entity,
      });
    }
  }

  return {
    async add(record): Promise<void> {
      if (closed) {
        throw new SinkClosed();
      }
      buffer.push(record);
      if (buffer.length >= chunk) {
        await flush();
      }
    },
    async close(): Promise<LandSummary> {
      await flush();
      closed = true;
      return { landed: created + unchanged, created, unchanged, refused };
    },
  };
}

export function createDocumentSink(
  deps: SinkDeps,
  at: DocumentLanding,
  chunk: number = CHUNK,
): DocumentSink {
  const buffer: DocumentToLand[] = [];
  const tally = { created: 0, unchanged: 0, skipped: 0, failed: 0 };
  let closed = false;

  async function flush(): Promise<void> {
    if (buffer.length === 0) {
      return;
    }
    const chunkOf = buffer.splice(0);
    const result = await landDocuments(deps.lake, {
      source: at.source,
      tenantId: at.tenantId,
      runId: at.runId,
      documents: chunkOf,
    });
    tally.created += result.created;
    tally.unchanged += result.unchanged;
    tally.skipped += result.skipped;
    tally.failed += result.failed;

    // The join that used to be a `find` over every document in the harvest, run once per
    // result. Here it is over this chunk alone, which is what makes it linear in the mailbox.
    // Walking the documents rather than the results is what leaves nothing unaccounted for:
    // every document asked for is either catalogued or refused with a reason.
    const resultOf = new Map(result.results.map((landed) => [landed.documentId, landed]));
    const rows: RawDocumentRow[] = [];
    const refusals: RunRefusal[] = [];
    for (const document of chunkOf) {
      const landed = resultOf.get(document.documentId);
      if (landed === undefined || landed.status === "skipped" || landed.status === "failed") {
        refusals.push({
          entity: DOCUMENT_ENTITY,
          sourceRecordId: document.documentId,
          reason: landed?.reason ?? landed?.status ?? "landed with no result",
        });
        continue;
      }
      rows.push(catalogueRow(document, landed, at));
    }
    await upsertDocuments(deps.exec, { source: at.source, tenantId: at.tenantId }, rows);
    await deps.refuse(refusals);
  }

  return {
    async add(document): Promise<void> {
      if (closed) {
        throw new SinkClosed();
      }
      buffer.push(document);
      if (buffer.length >= chunk) {
        await flush();
      }
    },
    async close(): Promise<DocumentSummary> {
      await flush();
      closed = true;
      return { landed: tally.created + tally.unchanged, ...tally };
    },
  };
}

/**
 * The catalogue row for a document whose bytes reached the lake.
 *
 * Only `metadata` crosses into Postgres. `raw.documents` is granted to `undercroft_dbt`, so
 * every column here is one `dbt run` from a dashboard; a filename, a subject or a folder name
 * stays in the lake manifest, which dbt and BI cannot reach at all. `.claude/rules/pii.md`,
 * ADR 0015. A skipped or failed document gets no row: it has no bytes to point at, and a row
 * claiming otherwise is worse than no row.
 */
function catalogueRow(
  document: DocumentToLand,
  landed: LandedDocument,
  at: DocumentLanding,
): RawDocumentRow {
  return {
    documentId: landed.documentId,
    lakeKey: landed.lakeKey ?? "",
    sha256: landed.sha256 ?? "",
    byteLength: landed.byteLength ?? "0",
    contentType: document.contentType,
    metadataJson: JSON.stringify({
      ...document.metadata,
      sourceUpdatedAt: document.sourceUpdatedAt,
    }),
    observedAt: at.observedAt,
    runId: at.runId,
  };
}

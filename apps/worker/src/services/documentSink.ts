/**
 * The document half of a sink: bytes into the lake, a row into the catalogue, and a memory of
 * how each one went.
 *
 * `landing.ts` holds the contract and the reasoning. What is only true HERE is that a chunk's
 * documents are paired with their landing results as they land -- the join that used to be a
 * `find` over the whole harvest, once per result -- and that what settled is REMEMBERED across
 * the landings the caller did not ask for, which is what lets `flush` answer for all of them.
 */

import { type RawDocumentRow, upsertDocuments } from "../repos/rawDocuments.ts";
import type { RunRefusal } from "@undercroft/db/repos";

import { type DocumentToLand, type LandedDocument, landDocuments } from "./landDocument.ts";
import {
  CHUNK,
  type DocumentLanding,
  type DocumentOutcome,
  type DocumentSink,
  type DocumentSummary,
  SinkClosed,
  type SinkDeps,
} from "./landing.ts";

/** The entity a refused document is filed under. Documents are their own entity in the ledger. */
const DOCUMENT_ENTITY = "documents";

/** One landed chunk of documents, split three ways. */
interface SortedChunk {
  readonly rows: RawDocumentRow[];
  readonly refusals: RunRefusal[];
  /** Refused and RETRYABLE, which is not the same set as refused. See {@link DocumentSink}. */
  readonly unfetched: string[];
}

/**
 * Pair each document with what landing it did, and file it under one of three answers.
 *
 * This is the join that used to be a `find` over every document in the whole harvest, run
 * once per result -- quadratic in the size of the mailbox. Here it is over one chunk, which
 * is what makes it linear. Walking the DOCUMENTS rather than the results is what leaves
 * nothing unaccounted for: every document asked for is either catalogued or refused with a
 * reason, and a result that came back for nothing anybody asked about cannot slip past.
 */
function sortChunk(
  chunkOf: readonly DocumentToLand[],
  result: Awaited<ReturnType<typeof landDocuments>>,
  at: DocumentLanding,
): SortedChunk {
  const resultOf = new Map(result.results.map((landed) => [landed.documentId, landed]));
  const sorted: SortedChunk = { rows: [], refusals: [], unfetched: [] };

  for (const document of chunkOf) {
    const landed = resultOf.get(document.documentId);
    if (landed !== undefined && landed.status !== "skipped" && landed.status !== "failed") {
      sorted.rows.push(catalogueRow(document, landed, at));
      continue;
    }
    sorted.refusals.push({
      entity: DOCUMENT_ENTITY,
      sourceRecordId: document.documentId,
      reason: landed?.reason ?? landed?.status ?? "landed with no result",
    });
    if (landed?.status !== "skipped") {
      sorted.unfetched.push(document.documentId);
    }
  }

  return sorted;
}

/** What one chunk of documents did: the four counters, and the ids behind two of them. */
interface DocumentChunkOutcome {
  readonly tally: { created: number; unchanged: number; skipped: number; failed: number };
  /** Bytes in the lake AND a catalogue row pointing at them. That pairing IS "landed". */
  readonly landed: readonly string[];
  readonly unfetched: readonly string[];
}

/**
 * Land one chunk into the lake and the catalogue, and say what became of each document.
 *
 * A function rather than a closure, so what the sink REMEMBERS is visibly separate from what
 * it does. A document refused for its declared size is in neither id list, which is the one
 * distinction the caller above cannot make for itself and the reason this answers with ids at
 * all rather than with counts.
 */
async function landDocumentChunk(
  deps: SinkDeps,
  at: DocumentLanding,
  chunkOf: readonly DocumentToLand[],
): Promise<DocumentChunkOutcome> {
  const result = await landDocuments(deps.lake, {
    source: at.source,
    tenantId: at.tenantId,
    runId: at.runId,
    documents: chunkOf,
  });

  const sorted = sortChunk(chunkOf, result, at);
  await upsertDocuments(deps.exec, { source: at.source, tenantId: at.tenantId }, sorted.rows);
  await deps.refuse(sorted.refusals);

  return {
    tally: {
      created: result.created,
      unchanged: result.unchanged,
      skipped: result.skipped,
      failed: result.failed,
    },
    landed: sorted.rows.map((row) => row.documentId),
    unfetched: sorted.unfetched,
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
  // What has settled since the caller last asked. Bounded by the documents added between two
  // `flush` calls -- one chunk of records' worth for the collectors -- and emptied by `flush`,
  // so it is flat in the size of the source like everything else here.
  let settled = { landed: new Set<string>(), unfetched: new Set<string>() };

  /** Land what is held, and REMEMBER how it went. The remembering is the whole of the fix. */
  async function land(): Promise<void> {
    if (buffer.length === 0) {
      return;
    }
    const outcome = await landDocumentChunk(deps, at, buffer.splice(0));
    tally.created += outcome.tally.created;
    tally.unchanged += outcome.tally.unchanged;
    tally.skipped += outcome.tally.skipped;
    tally.failed += outcome.tally.failed;
    for (const id of outcome.landed) {
      settled.landed.add(id);
    }
    for (const id of outcome.unfetched) {
      settled.unfetched.add(id);
    }
  }

  return {
    async add(document): Promise<void> {
      if (closed) {
        throw new SinkClosed();
      }
      buffer.push(document);
      if (buffer.length >= chunk) {
        await land();
      }
    },
    async flush(): Promise<DocumentOutcome> {
      await land();
      const outcome = settled;
      settled = { landed: new Set<string>(), unfetched: new Set<string>() };
      return outcome;
    },
    async close(): Promise<DocumentSummary> {
      await land();
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

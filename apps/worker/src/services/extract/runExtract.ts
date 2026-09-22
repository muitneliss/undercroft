/**
 * One extract pass over a tenant's landed documents.
 *
 * WHY THIS IS ITS OWN VERB and not the tail of an ingest: reading 252 MB of PDFs is tens of
 * minutes of CPU on a real tenant. Chained to every sync it would make an ingest's duration a
 * function of how much reading is outstanding, and a failed read look like a failed sync --
 * two different facts wearing one status. It opens its own `ops.run`, and the unique index on
 * `(tenant_id, source, verb)` lets it run beside an ingest rather than against it. ADR 0024.
 *
 * WHAT IT READS is whatever `pendingDocuments` returns: never read, read from bytes that have
 * since changed, or REFUSED BY AN OLDER GENERATION OF READERS. A second pass over an unchanged
 * tenant therefore does nothing at all -- that is the `source_sha256` mechanism doing its job,
 * and it is the difference between this being schedulable and being a thing you run once by
 * hand. The generation is `CURRENT_READER_VERSION`, asked for and stamped from one constant in
 * one pass, so adding a reader is what re-queues the documents it was added for.
 *
 * EVERY DOCUMENT LEAVES WITH AN ANSWER. A reader that failed, a type nobody reads, a binary
 * that is not installed -- each is a row carrying its reason, never an absent row. An absent
 * row means "not read yet" and would put the document straight back in the next run's queue,
 * forever, at full cost.
 *
 * IT READS ONCE PER DISTINCT DIGEST, AND ANSWERS EVERY DOCUMENT HOLDING IT. `raw.documents` is
 * provenance-addressed, so a quoted attachment is one row per message -- 4,476 rows over 2,030
 * digests on production -- and a thirty-page duplicate scan is thirty-one child processes spent
 * reproducing text we hold verbatim. The repo collapses the backlog and fans the answer back
 * out, within one tenant and one source; this file just has to count what came of it. So the
 * numbers below are DOCUMENTS, taken from what the write reports, while the pacing and the
 * journal's total are READS. The two used to be one number and now differ by the duplication.
 *
 * THE JOURNAL NAMES NOTHING. `runJournal` caps an event at 60 characters and `pii.md` keeps
 * filenames out of Postgres entirely; what is narrated here is counts and opaque document
 * ids, which is what the rest of the ledger carries too.
 */

import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SqlExecutor } from "@undercroft/db";
import type { LakeStore } from "@undercroft/lake";

import {
  type AnsweredDocuments,
  type DocumentTextRow,
  type PendingDocument,
  pendingDocuments,
  upsertDocumentText,
} from "../../repos/documentText.ts";
import { type RunJournal, SILENT_JOURNAL } from "../runJournal.ts";
import type { Spawn } from "../transform.ts";
import { CURRENT_READER_VERSION, extractDocument } from "./extractText.ts";

/** Documents read in one pass. A cap, so one run cannot hold the verb open for hours. */
export const DEFAULT_BATCH = 500;

export interface ExtractRunDeps {
  readonly exec: SqlExecutor;
  readonly lake: LakeStore;
  /** Injected; the process passes one that runs the real binaries. */
  readonly spawn: Spawn;
  readonly journal?: RunJournal;
  readonly now?: () => Date;
  /**
   * The child's environment. It carries `PATH`, which is how `Bun.spawn` finds `pdftotext`
   * at all -- an empty one made every PDF report the binary as missing on a machine that
   * had it installed. The composition root passes the process's own, exactly as it does for
   * dbt; a layer below it never reaches for `process.env` (`layering.md`).
   */
  readonly env?: Readonly<Record<string, string>>;
  /** Where a document's bytes are written for a binary to open. Defaults to the OS temp dir. */
  readonly scratchDir?: string;
  readonly batch?: number;
}

export interface ExtractResult {
  readonly runId: string;
  readonly source: string;
  /** Documents that left with a `method`. */
  readonly read: number;
  /** Documents that left with a `reason`. Not failures of the run -- answers about a document. */
  readonly refused: number;
  /** Documents whose bytes could not be fetched from the lake at all. */
  readonly unreadable: number;
}

/**
 * Read one document's bytes onto disk so a program can open it by name.
 *
 * On disk rather than through stdin because the binaries differ on what they accept, and a
 * path works for all of them. The file is removed whether the read succeeded or not; a run
 * over a large tenant would otherwise leave hundreds of megabytes behind in the temp dir.
 */
async function withBytesOnDisk<T>(
  dir: string,
  documentId: string,
  bytes: Uint8Array,
  use: (path: string) => Promise<T>,
): Promise<T> {
  // The provider's own id is opaque, but it is not a filename: a Drive id is safe, a Gmail
  // document id carries a colon. Hashing is overkill; replacing what a path cannot hold is not.
  const path = join(dir, `doc-${documentId.replaceAll(/[^\w.-]/gu, "_")}`);
  await writeFile(path, bytes);
  try {
    return await use(path);
  } finally {
    await rm(path, { force: true });
  }
}

/**
 * The catalogue says the bytes are there and the lake disagrees.
 *
 * Recorded against the document rather than raised, so one unreadable object does not end a
 * pass over the other 499 -- and counted apart from a refusal, because "we could not fetch
 * it" is a fact about the store while "we could not read it" is a fact about the document.
 */
const LAKE_UNREADABLE = "lake-object-unreadable";

/** One document: fetched from the lake, written down, read, and answered for either way. */
async function readOne(
  deps: ExtractRunDeps,
  scratch: string,
  document: PendingDocument,
): Promise<DocumentTextRow> {
  const base = { documentId: document.documentId, sourceSha256: document.sha256 };

  let bytes: Uint8Array;
  try {
    bytes = await deps.lake.read(document.lakeKey);
  } catch {
    return { ...base, method: null, reason: LAKE_UNREADABLE, text: "", truncated: false };
  }

  const extracted = await withBytesOnDisk(scratch, document.documentId, bytes, (path) =>
    extractDocument(
      { spawn: deps.spawn, workDir: scratch, ...(deps.env === undefined ? {} : { env: deps.env }) },
      { contentType: document.contentType, bytes, path },
    ),
  );

  return {
    ...base,
    method: extracted.method,
    reason: extracted.reason,
    text: extracted.text,
    truncated: extracted.truncated,
  };
}

/**
 * What the pass did, in documents rather than in reads.
 *
 * Each read is weighted by how many catalogue rows it answered, so `read` keeps meaning
 * "documents that left with a method" -- the thing `job.ts` records as the run's `created` and a
 * customer sees on the run. Counting reads instead would quietly halve that number the day the
 * fan-out landed, for a pass that did strictly more.
 */
function tally(
  rows: readonly DocumentTextRow[],
  answered: AnsweredDocuments,
): { read: number; refused: number; unreadable: number } {
  let read = 0;
  let refused = 0;
  let unreadable = 0;
  for (const row of rows) {
    const documents = answered.get(row.documentId) ?? 0;
    if (row.reason === LAKE_UNREADABLE) {
      unreadable += documents;
    } else if (row.method === null) {
      refused += documents;
    } else {
      read += documents;
    }
  }
  return { read, refused, unreadable };
}

export async function runExtract(
  deps: ExtractRunDeps,
  input: { tenantId: string; source: string; runId: string },
): Promise<ExtractResult> {
  const journal = deps.journal ?? SILENT_JOURNAL;
  const scratch = deps.scratchDir ?? tmpdir();
  const extractedAt = (deps.now ?? ((): Date => new Date()))().toISOString();
  const scope = { tenantId: input.tenantId, source: input.source };

  // One generation asked for and one generation written, in the same pass and from the same
  // constant. Asking with an older number than it stamps would leave a re-read row still
  // pending; the reverse would take a document out of the backlog no reader had looked at.
  const pending = await pendingDocuments(deps.exec, scope, {
    limit: deps.batch ?? DEFAULT_BATCH,
    readerVersion: CURRENT_READER_VERSION,
  });

  // The most useful line this run writes. What follows is one read per distinct digest --
  // minutes for a real tenant -- and a total up front turns a blank screen into a quantity.
  // It is the work, not the outcome: the documents answered is the larger number below.
  journal.info("work_listed", { entity: "documents", total: pending.length });

  const rows: DocumentTextRow[] = [];

  for (const document of pending) {
    journal.progress("documents_read", {
      entity: "documents",
      read: rows.length,
      total: pending.length,
    });

    rows.push(await readOne(deps, scratch, document));
  }

  const answered = await upsertDocumentText(deps.exec, scope, rows, {
    extractedAt,
    runId: input.runId,
    readerVersion: CURRENT_READER_VERSION,
  });
  const { read, refused, unreadable } = tally(rows, answered);

  journal.info("documents_extracted", {
    entity: "documents",
    read,
    refused,
    unreadable,
  });

  return { runId: input.runId, source: input.source, read, refused, unreadable };
}

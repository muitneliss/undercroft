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

import { tmpdir } from "node:os";

import type { SqlExecutor } from "@undercroft/db";
import type { RunReasonCount, RunRefusal } from "@undercroft/db/repos";
import type { LakeStore } from "@undercroft/lake";

import {
  countPendingDocuments,
  type DocumentTextRow,
  type PendingDocument,
  pendingDocuments,
  upsertDocumentText,
} from "../../repos/documentText.ts";
import { relayTexts, staleLayouts } from "../../repos/documentLayout.ts";
import { type RunJournal, SILENT_JOURNAL } from "../runJournal.ts";
import type { Transactor } from "../runTypes.ts";
import type { Spawn } from "../transform.ts";
import {
  CURRENT_LAYOUT_VERSION,
  CURRENT_READER_VERSION,
  RELAYABLE_METHODS,
  relayText,
} from "./extractText.ts";
import { type ArchiveLander, archiveLander, type MembersLanded } from "./archiveMembers.ts";
import { DOCUMENTS, LAKE_UNREADABLE, passCounts } from "./passCounts.ts";
import { readBytes } from "./readDocument.ts";
import { backfillWorkbooks, type WorkbookWriter, workbookWriter } from "./workbookRows.ts";

/** Documents read in one pass. A cap, so one run cannot hold the verb open for hours. */
export const DEFAULT_BATCH = 500;

export interface ExtractRunDeps {
  readonly exec: SqlExecutor;
  readonly lake: LakeStore;
  /**
   * The transaction a workbook's rows are replaced in (ADR 0104 decision 8). Required, not
   * defaulted to autocommit: a delete and its inserts committed one statement at a time would
   * leave a reader seeing a digest with no rows, or half of them, while a pass is writing.
   */
  readonly transactor: Transactor;
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
  /**
   * Documents that left with a `reason`, and archive members that did not land (ADR 0108). Not
   * failures of the run -- answers about a document.
   */
  readonly refused: number;
  /** Documents whose bytes could not be fetched from the lake at all. */
  readonly unreadable: number;
  /** Texts laid out again from themselves under a newer layout, none of them read again. */
  readonly relaid: number;
  /**
   * Every document this run would not read, with its reason, for `ops.run_refusal`.
   *
   * WHY THE LEDGER TOO, when `raw.document_text.reason` already holds each one: that table
   * answers "what does this document say", the ledger answers "what did this run do", and a
   * reader looking at a run cannot reach the first without already knowing it exists. This
   * verb sent somebody to an SSH session for precisely that reason -- its refusals were
   * recorded somewhere true and nowhere findable.
   *
   * `pii.md`: the id here is the provider's own opaque document id. Never a filename -- that
   * lives in the lake manifest and does not come back out.
   */
  readonly refusals: readonly RunRefusal[];
  /**
   * The refusals counted by reason, IN DOCUMENTS -- the half that outlives the 7-day prune.
   *
   * Weighted by the fan-out exactly as `tally` is, so these sum to `refused` and the rollup a
   * reader presses is an account of the number printed above it. Counting reads instead would
   * put two figures on one leaf that disagree by the duplication with nothing to explain it,
   * which is a smaller version of the defect the rollup exists to close.
   */
  readonly reasonCounts: readonly RunReasonCount[];
  /** How many documents were waiting in total when this run drew its batch. */
  readonly pendingBefore: number;
}

/** Where one pass's reads put what they need to: bytes on disk, a workbook's rows, members. */
interface Pass {
  readonly scratch: string;
  readonly workbooks: WorkbookWriter;
  readonly archives: ArchiveLander;
}

/**
 * One document: fetched from the lake, written down, read, and answered for either way.
 *
 * A WORKBOOK'S ROWS ARE WRITTEN HERE, per digest, the moment it is read, rather than with the
 * batch's texts at the end: a batch is 500 reads, and holding 500 workbooks' sheets until then
 * is what the `--smol` heap cannot do. A read that was refused writes no rows, so a failed
 * re-read leaves the rows already held where they are (ADR 0104 decision 8).
 */
async function readOne(
  deps: ExtractRunDeps,
  pass: Pass,
  document: PendingDocument,
): Promise<DocumentTextRow> {
  const base = { documentId: document.documentId, sourceSha256: document.sha256 };
  const extracted = await readBytes(deps, pass.scratch, document);
  if (extracted === null) {
    return { ...base, method: null, reason: LAKE_UNREADABLE, text: "", truncated: false };
  }

  if (extracted.workbook !== undefined) {
    await pass.workbooks.write(document.sha256, extracted.workbook);
  }
  if (extracted.archive !== undefined) {
    await pass.archives.land(document, extracted.archive);
  }

  return {
    ...base,
    method: extracted.method,
    reason: extracted.reason,
    text: extracted.text,
    truncated: extracted.truncated,
  };
}

/**
 * The batch, one read per distinct digest, answered for either way.
 *
 * Sequential on purpose: each read spawns a child process over bytes held in memory, and the
 * `--smol` heap this worker runs under (`deploy/Dockerfile.worker`) is sized for one of those
 * at a time, not for the batch at once.
 */
async function readEach(
  deps: ExtractRunDeps,
  pass: Pass,
  pending: readonly PendingDocument[],
  journal: RunJournal,
): Promise<DocumentTextRow[]> {
  const rows: DocumentTextRow[] = [];

  for (const document of pending) {
    journal.progress("documents_read", {
      entity: DOCUMENTS,
      read: rows.length,
      total: pending.length,
    });

    rows.push(await readOne(deps, pass, document));
  }

  return rows;
}

/**
 * Lay out again, from itself, each text of this scope written under an older layout -- a
 * profile read as unwrapped `data` before its ACRA template was known. Nothing is fetched from
 * the lake and nothing is verified again; see `relaid` in `openAttestation.ts` for why that is
 * the safe way round. Returns how many texts changed.
 */
async function relayStale(
  deps: ExtractRunDeps,
  scope: { tenantId: string; source: string },
  stamp: { extractedAt: string; runId: string; layoutVersion: number },
): Promise<number> {
  const stale = await staleLayouts(deps.exec, scope, {
    methods: RELAYABLE_METHODS,
    layoutVersion: stamp.layoutVersion,
    limit: deps.batch ?? DEFAULT_BATCH,
  });
  const relaid = stale.map((stored) => {
    const relayed = relayText(stored.method, stored.text);
    return {
      documentId: stored.documentId,
      sourceSha256: stored.sourceSha256,
      text: relayed?.text ?? null,
      truncated: relayed?.truncated ?? false,
    };
  });
  return await relayTexts(deps.exec, scope, relaid, stamp);
}

/**
 * Report the workbook rows this pass wrote, then write the rows owed to workbooks read before
 * them -- after the reads, so a workbook this run just read is not owed its rows. Counts only:
 * the journal names nothing.
 */
async function finishWorkbooks(
  deps: ExtractRunDeps,
  pass: { tenantId: string; source: string; extractedAt: string; runId: string; scratch: string },
  workbooks: WorkbookWriter,
): Promise<void> {
  const journal = deps.journal ?? SILENT_JOURNAL;
  journal.info("workbook_rows_written", { entity: DOCUMENTS, ...workbooks.counts() });
  const backfilled = await backfillWorkbooks(
    deps,
    { ...pass, limit: deps.batch ?? DEFAULT_BATCH },
    (owed) => readBytes(deps, pass.scratch, owed),
  );
  journal.info("workbook_rows_backfilled", { entity: DOCUMENTS, ...backfilled });
}

/** The batch read, and what its reads put in place: a workbook's rows, an archive's members. */
async function readBatch(
  deps: ExtractRunDeps,
  pass: { tenantId: string; source: string; extractedAt: string; runId: string; scratch: string },
  pending: readonly PendingDocument[],
  journal: RunJournal,
): Promise<{ rows: DocumentTextRow[]; workbooks: WorkbookWriter; members: MembersLanded }> {
  const { scratch, ...at } = pass;
  const workbooks = workbookWriter(deps.transactor, at);
  const archives = archiveLander({ ...deps, journal }, { ...at, observedAt: at.extractedAt });
  const rows = await readEach(deps, { scratch, workbooks, archives }, pending, journal);
  return { rows, workbooks, members: await archives.finish() };
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

  // How deep the queue is, as against how much of it this run will take. `pending.length` is
  // capped at the batch AND collapsed to one row per digest, so it says "the work this run will
  // do" twice over and never "how much is left" -- which is the question a high refusal count
  // actually raises. Counted in documents, the unit `tally` reports below. Asked with the same
  // generation the batch was drawn with.
  const pendingBefore = await countPendingDocuments(deps.exec, scope, {
    readerVersion: CURRENT_READER_VERSION,
  });

  // The most useful line this run writes. What follows is one read per distinct digest --
  // minutes for a real tenant -- and a total up front turns a blank screen into a quantity.
  // It is the work, not the outcome: the documents answered is the larger number below.
  journal.info("work_listed", { entity: DOCUMENTS, total: pending.length });

  const pass = { ...scope, extractedAt, runId: input.runId, scratch };
  const { rows, workbooks, members } = await readBatch(deps, pass, pending, journal);

  const stamp = { extractedAt, runId: input.runId, layoutVersion: CURRENT_LAYOUT_VERSION };
  const answered = await upsertDocumentText(deps.exec, scope, rows, {
    ...stamp,
    readerVersion: CURRENT_READER_VERSION,
  });
  const counts = passCounts(rows, answered, members);
  // After the reads, so a text this run just wrote is already in the current layout and is
  // not looked at twice.
  const relaid = await relayStale(deps, scope, stamp);

  const { read, refused, unreadable } = counts;
  journal.info("documents_extracted", { entity: DOCUMENTS, read, refused, unreadable, relaid });

  await finishWorkbooks(deps, pass, workbooks);

  return {
    runId: input.runId,
    source: input.source,
    ...counts,
    relaid,
    pendingBefore,
  };
}

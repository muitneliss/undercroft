/**
 * `raw.document_text`: what each landed document says, and how it came to be read.
 *
 * Three statements, and the first is the one that decides the bill. `pendingDocuments` answers
 * "which documents does this tenant have that nobody has read, has read from bytes that have
 * since changed, or refused with a reader older than the one we now have" -- the LEFT JOIN on
 * `source_sha256` is the whole mechanism for the middle case. A document whose sha matches what
 * was extracted from is not returned at all, so a second extract run over an unchanged tenant
 * spawns nothing and re-OCRs nothing. Without it the only options are re-reading 252 MB of PDFs
 * on every run, or never noticing a file that changed.
 *
 * The third case is the READER GENERATION, and it is why these functions take one. A refusal
 * is a fact about the readers we had, not about the document, and a platform that never revisits
 * one ships each new reader as a no-op over the files it was written for. `reader_version`
 * (`packages/db/sql/240_reader_version.sql`) is the stamp; the predicate below is the rule.
 *
 * A tombstoned document (`deleted_at`) is skipped: its bytes are gone from the source, and
 * re-reading a document the customer deleted is the opposite of what the tombstone records.
 *
 * `pendingScopes` asks the SAME question one level up -- which (tenant, source) pairs have
 * any such document -- because the scheduler needs a list to start runs from and must not
 * start one that would find nothing to do. The two share `PENDING_JOIN` rather than spelling
 * the predicate twice: two definitions of "pending" drifting apart would show up as a flow
 * that ticks forever over a tenant whose documents the run then declines to read.
 *
 * Nothing here decides anything. Which reader a content type gets, and what counts as a
 * readable text layer, are decisions one layer up in `../services/extract/`.
 */

import type { SqlExecutor } from "@undercroft/db";

/** One document waiting to be read, with what a reader needs to fetch and open it. */
export interface PendingDocument {
  readonly documentId: string;
  readonly lakeKey: string;
  readonly sha256: string;
  readonly contentType: string;
}

/**
 * What was true of the pass as a whole, rather than of one document.
 *
 * `readerVersion` belongs here and not on a row: it is the generation of the reader TABLE that
 * ran, so every document in one pass was read by the same one. A per-row field would invite a
 * caller to write two generations in a single batch, which is a state nothing downstream could
 * interpret.
 */
export interface ExtractStamp {
  readonly extractedAt: string;
  readonly runId: string;
  readonly readerVersion: number;
}

/** One document's text, ready to be written. `method` or `reason` -- never neither. */
export interface DocumentTextRow {
  readonly documentId: string;
  readonly sourceSha256: string;
  readonly method: string | null;
  readonly reason: string | null;
  readonly text: string;
  readonly truncated: boolean;
}

interface Scope {
  readonly tenantId: string;
  readonly source: string;
}

/**
 * "Landed, not tombstoned, and either never read, read from bytes that have since changed, or
 * refused by an older generation of readers."
 *
 * ONE definition, used by both readers below. A constant rather than a parameter because it is
 * the repo's own SQL and nothing outside this module composes with it: two definitions of
 * "pending" drifting apart would show up as a flow that ticks forever over a tenant whose
 * documents the run then declines to read.
 *
 * `$1` IS THE CURRENT READER GENERATION IN BOTH CALLERS, by construction -- each binds it first
 * and numbers its own parameters from `$2`. That is what lets one shared string name the value
 * at all. The repo cannot reach for the constant itself: `CURRENT_READER_VERSION` lives beside
 * the `READERS` map in the service layer, and a repo importing upward is the thing
 * `layering.md` forbids outright. So it arrives as a bind parameter, which is also the only
 * form that keeps a number out of a concatenated SQL string.
 *
 * THE `t.method IS NULL` SCOPE IS A SAFETY PROPERTY, NOT AN OPTIMISATION. Read that again
 * before widening it, because it reads exactly like a performance tweak and is not one.
 *
 * A ROW THAT WAS READ IS NEVER RE-QUEUED BY A GENERATION BUMP. A sibling project at this
 * company recorded its worst extraction bug as precisely this hazard: a re-parse run launched
 * without OCR configured overwrote 2,602 already-OCR'd documents with empty text, and every
 * gate it had stayed green because the row count never changed. Their law from it -- never swap
 * text for empty; when a cheap re-run can overwrite an expensive one, block it in code and not
 * in the operator's memory -- is this clause. The cost of bumping the constant is therefore
 * bounded to the refusals: on production, 1,190 documents once, and not the 409 good ones every
 * time.
 *
 * Spelled `t.method IS NULL` rather than `t.reason IS NOT NULL`, which selects the same rows
 * today -- the `document_text_said_why` CHECK means one is null exactly when the other is not --
 * but says the property itself. A future reader that records a method AND a caveat (text read,
 * but by a degraded engine) would be re-queued by the `reason` spelling and could then be
 * blanked by a worse run, which is the 2,602 documents again by a different door.
 */
const PENDING_JOIN = `FROM raw.documents d
       LEFT JOIN raw.document_text t
         ON t.source = d.source
        AND t.tenant_id = d.tenant_id
        AND t.document_id = d.document_id
      WHERE d.deleted_at IS NULL
        AND (t.document_id IS NULL
          OR t.source_sha256 <> d.sha256
          OR (t.method IS NULL AND t.reader_version < $1))`;

/** The generation of readers the caller is running. Named, so two numbers cannot swap places. */
interface Generation {
  readonly readerVersion: number;
}

/**
 * The documents this run has to read: never read, read from different bytes, or refused by a
 * reader generation older than `readerVersion`.
 *
 * Ordered by `document_id` so a capped run is resumable -- the next run asks the same
 * question and gets the same answer minus what the last one wrote, rather than a fresh
 * arbitrary slice of the same backlog.
 *
 * `limit` and `readerVersion` arrive named rather than as two positional numbers: a call
 * reading `(exec, scope, 500, 1)` is one a reviewer cannot check, and swapping them silently
 * reads one document per pass against a generation of 500.
 */
export async function pendingDocuments(
  exec: SqlExecutor,
  scope: Scope,
  { limit, readerVersion }: Generation & { readonly limit: number },
): Promise<PendingDocument[]> {
  const { rows } = await exec.query<{
    document_id: string;
    lake_key: string;
    sha256: string;
    content_type: string;
  }>(
    `SELECT d.document_id, d.lake_key, d.sha256, d.content_type
       ${PENDING_JOIN}
        AND d.source = $2
        AND d.tenant_id = $3
      ORDER BY d.document_id
      LIMIT $4`,
    [readerVersion, scope.source, scope.tenantId, limit],
  );

  return rows.map((row) => ({
    documentId: row.document_id,
    lakeKey: row.lake_key,
    sha256: row.sha256,
    contentType: row.content_type,
  }));
}

/**
 * Every (tenant, source) pair with a document waiting to be read.
 *
 * The scheduler's list. `DISTINCT` rather than a count, because the caller starts one run per
 * pair and how many documents that run will find is the run's own business -- and a count
 * over the whole catalogue is the scan this question exists to avoid.
 *
 * A pair vanishes from this list once its documents are read, which is what makes the tick
 * idempotent: an unchanged tenant is not returned, so nothing is started for it. That is the
 * same `source_sha256` mechanism `pendingDocuments` relies on, reached through the same
 * predicate -- and it is why this takes a generation too. A scheduler answering an older
 * question than the run it starts would tick over a tenant the run then finds nothing to do
 * for, which is the drift `PENDING_JOIN` exists to make impossible.
 */
export async function pendingScopes(
  exec: SqlExecutor,
  { readerVersion }: Generation,
): Promise<Scope[]> {
  const { rows } = await exec.query<{ tenantId: string; source: string }>(
    `SELECT DISTINCT d.tenant_id AS "tenantId", d.source
       ${PENDING_JOIN}
      ORDER BY 1, 2`,
    [readerVersion],
  );
  return rows.map((row) => ({ tenantId: row.tenantId, source: row.source }));
}

/**
 * Write what was read. An existing row for the same document is replaced.
 *
 * Replaced rather than versioned: this table is a projection of the lake, and the only
 * interesting version of a document's text is the one taken from the bytes it currently has.
 * History lives where history is durable, which is the lake (`raw-lake.md`).
 *
 * The stamp's `readerVersion` is written on EVERY row, refusals included -- that is what takes a
 * re-queued refusal back out of the backlog once this generation has had its go at it. A write
 * that skipped it for refusals would offer the same 1,190 documents to every run for ever.
 */
export async function upsertDocumentText(
  exec: SqlExecutor,
  scope: Scope,
  rows: readonly DocumentTextRow[],
  stamp: ExtractStamp,
): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }

  await exec.query(
    `INSERT INTO raw.document_text
        (source, tenant_id, document_id, source_sha256, method, reason,
         text, chars, truncated, extracted_at, run_id, reader_version)
     SELECT $1, $2, d.document_id, d.source_sha256, d.method, d.reason,
            d.text, char_length(d.text), d.truncated, $3::timestamptz, $4, $11::integer
       FROM unnest($5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::boolean[])
         AS d(document_id, source_sha256, method, reason, text, truncated)
     ON CONFLICT (source, tenant_id, document_id) DO UPDATE
        SET source_sha256  = excluded.source_sha256,
            method         = excluded.method,
            reason         = excluded.reason,
            text           = excluded.text,
            chars          = excluded.chars,
            truncated      = excluded.truncated,
            extracted_at   = excluded.extracted_at,
            run_id         = excluded.run_id,
            reader_version = excluded.reader_version`,
    [
      scope.source,
      scope.tenantId,
      stamp.extractedAt,
      stamp.runId,
      rows.map((r) => r.documentId),
      rows.map((r) => r.sourceSha256),
      rows.map((r) => r.method),
      rows.map((r) => r.reason),
      rows.map((r) => r.text),
      rows.map((r) => r.truncated),
      stamp.readerVersion,
    ],
  );

  return rows.length;
}

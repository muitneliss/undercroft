/**
 * `raw.document_text`: what each landed document says, and how it came to be read.
 *
 * Two statements, and the first is the one that decides the bill. `pendingDocuments` answers
 * "which documents does this tenant have that nobody has read, or has read from bytes that
 * have since changed" -- the LEFT JOIN on `source_sha256` is the whole mechanism. A document
 * whose sha matches what was extracted from is not returned at all, so a second extract run
 * over an unchanged tenant spawns nothing and re-OCRs nothing. Without it the only options
 * are re-reading 252 MB of PDFs on every run, or never noticing a file that changed.
 *
 * A tombstoned document (`deleted_at`) is skipped: its bytes are gone from the source, and
 * re-reading a document the customer deleted is the opposite of what the tombstone records.
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
 * The documents this run has to read: never read, or read from different bytes.
 *
 * Ordered by `document_id` so a capped run is resumable -- the next run asks the same
 * question and gets the same answer minus what the last one wrote, rather than a fresh
 * arbitrary slice of the same backlog.
 */
export async function pendingDocuments(
  exec: SqlExecutor,
  scope: Scope,
  limit: number,
): Promise<PendingDocument[]> {
  const { rows } = await exec.query<{
    document_id: string;
    lake_key: string;
    sha256: string;
    content_type: string;
  }>(
    `SELECT d.document_id, d.lake_key, d.sha256, d.content_type
       FROM raw.documents d
       LEFT JOIN raw.document_text t
         ON t.source = d.source
        AND t.tenant_id = d.tenant_id
        AND t.document_id = d.document_id
      WHERE d.source = $1
        AND d.tenant_id = $2
        AND d.deleted_at IS NULL
        AND (t.document_id IS NULL OR t.source_sha256 <> d.sha256)
      ORDER BY d.document_id
      LIMIT $3`,
    [scope.source, scope.tenantId, limit],
  );

  return rows.map((row) => ({
    documentId: row.document_id,
    lakeKey: row.lake_key,
    sha256: row.sha256,
    contentType: row.content_type,
  }));
}

/**
 * Write what was read. An existing row for the same document is replaced.
 *
 * Replaced rather than versioned: this table is a projection of the lake, and the only
 * interesting version of a document's text is the one taken from the bytes it currently has.
 * History lives where history is durable, which is the lake (`raw-lake.md`).
 */
export async function upsertDocumentText(
  exec: SqlExecutor,
  scope: Scope,
  rows: readonly DocumentTextRow[],
  stamp: { extractedAt: string; runId: string },
): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }

  await exec.query(
    `INSERT INTO raw.document_text
        (source, tenant_id, document_id, source_sha256, method, reason,
         text, chars, truncated, extracted_at, run_id)
     SELECT $1, $2, d.document_id, d.source_sha256, d.method, d.reason,
            d.text, char_length(d.text), d.truncated, $3::timestamptz, $4
       FROM unnest($5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::boolean[])
         AS d(document_id, source_sha256, method, reason, text, truncated)
     ON CONFLICT (source, tenant_id, document_id) DO UPDATE
        SET source_sha256 = excluded.source_sha256,
            method        = excluded.method,
            reason        = excluded.reason,
            text          = excluded.text,
            chars         = excluded.chars,
            truncated     = excluded.truncated,
            extracted_at  = excluded.extracted_at,
            run_id        = excluded.run_id`,
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
    ],
  );

  return rows.length;
}

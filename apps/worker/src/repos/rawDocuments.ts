/**
 * `raw.documents`: the catalogue of bytes the lake holds.
 *
 * The same two guards as `rawRecords.ts`, in SQL for the same reason -- a check written in
 * the loader binds only the loader that runs it, and two collectors landing the same
 * mailbox concurrently is a thing that happens:
 *
 * - **idempotent:** an unchanged document writes no new row version, so re-running over an
 *   unchanged mailbox is free;
 * - **no time travel:** a late-arriving older observation never overwrites a newer row.
 *
 * Split into two statements rather than one `ON CONFLICT ... RETURNING (xmax = 0)` for the
 * reason written out in `rawRecords.ts`: PGlite does not expose `xmax`, and the offline gate
 * runs on PGlite.
 *
 * `byte_length` is carried as a decimal *string* and cast by Postgres (`$n::bigint[]`).
 * `bigint` exceeds what a JS number holds exactly, and the money rule's reasoning applies
 * unchanged to a file size: a value that silently rounds is worse than one that refuses.
 *
 * Nothing here decides anything. What is too large to fetch, and which names a human wrote may
 * be written here, are decisions one layer up in `../services/landDocument.ts`.
 */

import type { SqlExecutor } from "@undercroft/db";

/** One observation of one document, ready to be written. */
export interface RawDocumentRow {
  readonly documentId: string;
  readonly lakeKey: string;
  readonly sha256: string;
  /** Decimal digits. Never a number -- see the module docstring. */
  readonly byteLength: string;
  readonly contentType: string;
  /**
   * JSON *text*, cast to jsonb by Postgres and never re-serialised here. Opaque provider
   * ids, timestamps, enumerated types and counts only; the file's name has its own column and
   * every other name belongs in the lake manifest. See `@undercroft/contracts`'s `rawDocument.ts`.
   */
  readonly metadataJson: string;
  readonly observedAt: string;
  readonly runId: string;
  /** `file_name` and `source_url` (`700_document_trace.sql`, ADR 0161); `null` when unknown. */
  readonly fileName: string | null;
  readonly sourceUrl: string | null;
}

export interface DocumentIdentity {
  readonly source: string;
  readonly tenantId: string;
}

export interface UpsertCounts {
  readonly created: number;
  readonly changed: number;
  readonly unchanged: number;
}

export async function upsertDocuments(
  exec: SqlExecutor,
  identity: DocumentIdentity,
  batch: readonly RawDocumentRow[],
): Promise<UpsertCounts> {
  if (batch.length === 0) {
    return { created: 0, changed: 0, unchanged: 0 };
  }

  const cols = [
    batch.map(() => identity.source),
    batch.map(() => identity.tenantId),
    batch.map((d) => d.documentId),
    batch.map((d) => d.lakeKey),
    batch.map((d) => d.sha256),
    batch.map((d) => d.byteLength),
    batch.map((d) => d.contentType),
    batch.map((d) => d.metadataJson),
    batch.map((d) => d.observedAt),
    batch.map((d) => d.runId),
    batch.map((d) => d.fileName),
    batch.map((d) => d.sourceUrl),
  ];

  const inserted = await exec.query<{ id: string }>(
    `INSERT INTO raw.documents (
        source, tenant_id, document_id, lake_key, sha256,
        byte_length, content_type, metadata, observed_at, run_id, file_name, source_url)
     SELECT * FROM unnest(
        $1::text[], $2::text[], $3::text[], $4::text[], $5::char(64)[],
        $6::bigint[], $7::text[], $8::jsonb[], $9::timestamptz[], $10::text[],
        $11::text[], $12::text[])
     ON CONFLICT (source, tenant_id, document_id) DO NOTHING
     RETURNING document_id AS id`,
    cols,
  );

  // New bytes are in the lake again until their own extraction is attempted, so a purge record
  // about the old ones is cleared with them (ADR 0161): left standing, it would keep the new
  // bytes out of the extract backlog for ever.
  const changed = await exec.query<{ id: string }>(
    `UPDATE raw.documents d SET
        lake_key            = v.lk,
        sha256              = v.sha,
        byte_length         = v.len,
        content_type        = v.ct,
        metadata            = v.meta,
        observed_at         = v.obs,
        run_id              = v.rid,
        file_name           = v.fn,
        source_url          = v.url,
        deleted_at          = NULL,
        bytes_purged_at     = NULL,
        bytes_purge_outcome = NULL,
        bytes_purge_report  = NULL
     FROM unnest(
        $1::text[], $2::text[], $3::text[], $4::text[], $5::char(64)[],
        $6::bigint[], $7::text[], $8::jsonb[], $9::timestamptz[], $10::text[],
        $11::text[], $12::text[])
        AS v(src, tid, did, lk, sha, len, ct, meta, obs, rid, fn, url)
     WHERE d.source = v.src AND d.tenant_id = v.tid AND d.document_id = v.did
       AND d.sha256      IS DISTINCT FROM v.sha
       AND d.observed_at <=              v.obs
     RETURNING d.document_id AS id`,
    cols,
  );

  await renameUnchanged(exec, identity, batch);

  const created = inserted.rows.length;
  const changedCount = changed.rows.length;
  return { created, changed: changedCount, unchanged: batch.length - created - changedCount };
}

/**
 * Bring a document's name and link up to date where its bytes did not change.
 *
 * A file renamed at the source keeps its bytes, so the upsert above calls it unchanged and
 * writes nothing -- which used to be right, because the name lived only in the manifest of the
 * observation that carried it. Now that the name is a column a person traces the file by (ADR
 * 0161), a stale one is a wrong value that looks right. Not counted: the bytes did not change,
 * and the counts are about bytes. The same no-time-travel guard as the rest.
 */
async function renameUnchanged(
  exec: SqlExecutor,
  identity: DocumentIdentity,
  batch: readonly RawDocumentRow[],
): Promise<void> {
  await exec.query(
    `UPDATE raw.documents d SET file_name = v.fn, source_url = v.url
       FROM unnest($3::text[], $4::char(64)[], $5::timestamptz[], $6::text[], $7::text[])
         AS v(did, sha, obs, fn, url)
      WHERE d.source = $1 AND d.tenant_id = $2 AND d.document_id = v.did
        AND d.sha256 = v.sha
        AND d.observed_at <= v.obs
        AND (d.file_name IS DISTINCT FROM v.fn OR d.source_url IS DISTINCT FROM v.url)`,
    [
      identity.source,
      identity.tenantId,
      batch.map((d) => d.documentId),
      batch.map((d) => d.sha256),
      batch.map((d) => d.observedAt),
      batch.map((d) => d.fileName),
      batch.map((d) => d.sourceUrl),
    ],
  );
}

/**
 * Tombstone the documents this run did not see.
 *
 * Only safe where absence genuinely means absence. Drive qualifies: a file no longer in a
 * selected folder is gone from our scope, and saying so is more honest than leaving a row
 * that implies we still watch it. **Gmail does not** -- a message that stops matching a
 * label selection has been relabelled, not deleted, and tombstoning it would report a
 * deletion that never happened.
 *
 * `deleted_at` is a statement about the source, not a licence to drop what we captured: the
 * bytes stay in the lake until extraction has had its attempt at them like any document's
 * (ADR 0161), and one tombstoned before it was ever read keeps them.
 *
 * A file read out of an archive is kept while its ARCHIVE is: its id is never in a listing, so
 * judged by its own id every member would be tombstoned by every ingest (ADR 0108 decision 6).
 */
export async function tombstoneMissing(
  exec: SqlExecutor,
  identity: DocumentIdentity,
  input: { keptIds: readonly string[]; observedAt: string },
): Promise<number> {
  const { rows } = await exec.query<{ id: string }>(
    `UPDATE raw.documents SET deleted_at = $3
     WHERE source = $1 AND tenant_id = $2
       AND deleted_at IS NULL
       AND NOT (coalesce(metadata->>'archiveDocumentId', document_id) = ANY($4::text[]))
     RETURNING document_id AS id`,
    [identity.source, identity.tenantId, input.observedAt, input.keptIds],
  );
  return rows.length;
}

/**
 * The live documents holding these bytes. An archive is read once per digest, and its members
 * land under every document holding it, so each message keeps its own (ADR 0108 decision 6).
 * With each holder's link at the source, which is where a member of it is opened (ADR 0161).
 */
export async function documentsHolding(
  exec: SqlExecutor,
  identity: DocumentIdentity,
  sha256: string,
): Promise<{ documentId: string; sourceUrl: string | null }[]> {
  const { rows } = await exec.query<{ id: string; url: string | null }>(
    `SELECT document_id AS id, source_url AS url FROM raw.documents
      WHERE source = $1 AND tenant_id = $2 AND sha256 = $3 AND deleted_at IS NULL
      ORDER BY document_id`,
    [identity.source, identity.tenantId, sha256],
  );
  return rows.map((row) => ({ documentId: row.id, sourceUrl: row.url }));
}

/**
 * Tombstone the members these archives no longer hold: an archive read again under new bytes
 * holds what it holds now, and a member at a position it has given up is gone from the source.
 */
export async function tombstoneStaleMembers(
  exec: SqlExecutor,
  identity: DocumentIdentity,
  input: { archiveIds: readonly string[]; keptIds: readonly string[]; observedAt: string },
): Promise<number> {
  const { rows } = await exec.query<{ id: string }>(
    `UPDATE raw.documents SET deleted_at = $3
     WHERE source = $1 AND tenant_id = $2
       AND deleted_at IS NULL
       AND metadata->>'archiveDocumentId' = ANY($4::text[])
       AND NOT (document_id = ANY($5::text[]))
     RETURNING document_id AS id`,
    [identity.source, identity.tenantId, input.observedAt, input.archiveIds, input.keptIds],
  );
  return rows.length;
}

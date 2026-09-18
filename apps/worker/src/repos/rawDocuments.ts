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
 * Nothing here decides anything. What is too large to fetch, and what a filename may be
 * written into, are decisions one layer up in `../services/landDocument.ts`.
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
   * ids, timestamps, enumerated types and counts only; a filename belongs in the lake
   * manifest. See `@undercroft/contracts`'s `rawDocument.ts`.
   */
  readonly metadataJson: string;
  readonly observedAt: string;
  readonly runId: string;
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
  ];

  const inserted = await exec.query<{ id: string }>(
    `INSERT INTO raw.documents (
        source, tenant_id, document_id, lake_key, sha256,
        byte_length, content_type, metadata, observed_at, run_id)
     SELECT * FROM unnest(
        $1::text[], $2::text[], $3::text[], $4::text[], $5::char(64)[],
        $6::bigint[], $7::text[], $8::jsonb[], $9::timestamptz[], $10::text[])
     ON CONFLICT (source, tenant_id, document_id) DO NOTHING
     RETURNING document_id AS id`,
    cols,
  );

  const changed = await exec.query<{ id: string }>(
    `UPDATE raw.documents d SET
        lake_key     = v.lk,
        sha256       = v.sha,
        byte_length  = v.len,
        content_type = v.ct,
        metadata     = v.meta,
        observed_at  = v.obs,
        run_id       = v.rid,
        deleted_at   = NULL
     FROM unnest(
        $1::text[], $2::text[], $3::text[], $4::text[], $5::char(64)[],
        $6::bigint[], $7::text[], $8::jsonb[], $9::timestamptz[], $10::text[])
        AS v(src, tid, did, lk, sha, len, ct, meta, obs, rid)
     WHERE d.source = v.src AND d.tenant_id = v.tid AND d.document_id = v.did
       AND d.sha256      IS DISTINCT FROM v.sha
       AND d.observed_at <=              v.obs
     RETURNING d.document_id AS id`,
    cols,
  );

  const created = inserted.rows.length;
  const changedCount = changed.rows.length;
  return { created, changed: changedCount, unchanged: batch.length - created - changedCount };
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
 * The bytes stay in the lake regardless. `deleted_at` is a statement about the source, not
 * a licence to drop what we captured.
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
       AND NOT (document_id = ANY($4::text[]))
     RETURNING document_id AS id`,
    [identity.source, identity.tenantId, input.observedAt, input.keptIds],
  );
  return rows.length;
}

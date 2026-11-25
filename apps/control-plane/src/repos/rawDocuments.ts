/**
 * `raw.documents`, one source's catalogue a page at a time, for one tenant. Split from
 * `rawLake.ts`, which keeps the summaries over both raw tables; everything there about scoping
 * holds here: read-only by grant, every statement scoped to one `tenant_id` in its WHERE clause,
 * because the platform role's `platform_all` policy would show every tenant's rows.
 *
 * Since ADR 0161 a page carries the file's name, its link at the source and whether its bytes
 * were purged after extraction -- which is how a reader finds a document the lake no longer
 * holds the bytes of. Not the bytes, and not `metadata` beyond its `sourceUpdatedAt`: opaque
 * provider ids by contract, but the contract is what keeps names out of it, and a browser is not
 * the place to test it.
 */

import type { SqlExecutor } from "@undercroft/db";
import { decodeCursor, encodeCursor } from "@undercroft/db/repos";

import type { Page } from "./rawLake.ts";

export interface RawDocument {
  readonly source: string;
  readonly documentId: string;
  readonly contentType: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly observedAt: string;
  readonly runId: string;
  readonly deletedAt: string | null;
  /**
   * What the source calls the file, and where a person opens it there (ADR 0161). `null` where
   * the source gives it none -- a mail's body, a HubSpot note -- or none can be derived.
   */
  readonly fileName: string | null;
  readonly sourceUrl: string | null;
  /** When the source last changed it, as it said; `null` where it did not say. */
  readonly sourceUpdatedAt: string | null;
  /**
   * When its bytes left the lake, once extraction had had its go at them; `null` while held. The
   * outcome is `deleted`, or `absent` when the blob was already gone.
   */
  readonly bytesPurgedAt: string | null;
  readonly bytesPurgeOutcome: "deleted" | "absent" | null;
}

interface DocumentRow {
  source: string;
  document_id: string;
  content_type: string;
  bytes: number;
  sha256: string;
  observed_at: Date | string;
  run_id: string;
  deleted_at: Date | string | null;
  file_name: string | null;
  source_url: string | null;
  source_updated_at: string | null;
  bytes_purged_at: Date | string | null;
  bytes_purge_outcome: "deleted" | "absent" | null;
}

// A size is a count, exact in a double to 2^53 -- the cast says so at the one place it happens
// (`rawLake.ts` on the pinned parsers).
const DOCUMENT_COLUMNS = `source, document_id, content_type, byte_length::float8 AS bytes,
  sha256, observed_at, run_id, deleted_at, file_name, source_url,
  metadata->>'sourceUpdatedAt' AS source_updated_at, bytes_purged_at, bytes_purge_outcome`;

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function isoOrNull(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

function toDocument(r: DocumentRow): RawDocument {
  return {
    source: r.source,
    documentId: r.document_id,
    contentType: r.content_type,
    bytes: r.bytes,
    sha256: r.sha256,
    observedAt: iso(r.observed_at),
    runId: r.run_id,
    deletedAt: isoOrNull(r.deleted_at),
    fileName: r.file_name,
    sourceUrl: r.source_url,
    sourceUpdatedAt: r.source_updated_at,
    bytesPurgedAt: isoOrNull(r.bytes_purged_at),
    bytesPurgeOutcome: r.bytes_purge_outcome,
  };
}

/**
 * The document catalogue for one source, newest first, a page at a time -- all of it, or only
 * the rows that name one run, as `listRecords` reads a run.
 */
export async function listDocuments(
  exec: SqlExecutor,
  tenantId: string,
  stream: { source: string; runId?: string | null },
  page: { limit: number; cursor?: string | null },
): Promise<Page<RawDocument>> {
  const after = decodeCursor(page.cursor);
  const { rows } = await exec.query<DocumentRow>(
    `SELECT ${DOCUMENT_COLUMNS} FROM raw.documents
     WHERE tenant_id = $1 AND source = $2
       AND ($4::text IS NULL OR run_id = $4::text)
       AND ($5::timestamptz IS NULL OR (observed_at, document_id) < ($5::timestamptz, $6::text))
     ORDER BY observed_at DESC, document_id DESC LIMIT $3`,
    [
      tenantId,
      stream.source,
      page.limit + 1,
      stream.runId ?? null,
      after?.at ?? null,
      after?.id ?? null,
    ],
  );
  const items = rows.slice(0, page.limit).map(toDocument);
  const last = items.at(-1);
  const nextCursor =
    rows.length > page.limit && last !== undefined
      ? encodeCursor(last.observedAt, last.documentId)
      : null;
  return { items, nextCursor };
}

/** How many of one source's catalogue rows still name this run, as `countRecordsOfRun` counts. */
export async function countDocumentsOfRun(
  exec: SqlExecutor,
  tenantId: string,
  stream: { source: string; runId: string },
): Promise<number> {
  const { rows } = await exec.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM raw.documents
     WHERE tenant_id = $1 AND source = $2 AND run_id = $3`,
    [tenantId, stream.source, stream.runId],
  );
  return rows[0]?.n ?? 0;
}

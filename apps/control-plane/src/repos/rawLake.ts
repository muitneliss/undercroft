/**
 * Reading the raw lake's Postgres projection for one tenant: what landed, and the rows.
 *
 * Read-only by construction and by grant: the control plane holds SELECT on `raw.records`
 * and `raw.documents` and nothing else in `raw`. Every statement here is scoped to one
 * `tenant_id` in its WHERE clause; the platform role sees every tenant's rows (the RLS
 * policy `platform_all`), so the scoping is this module's responsibility and is not
 * something the database would refuse for it.
 *
 * `payload` leaves this module as TEXT, rendered by Postgres (`jsonb_pretty`), never as a
 * parsed object. A payload that has been through `JSON.parse` has had every number turned
 * into a float, and a browser that prints `12345678901234567000` where the source said
 * `12345678901234567890` is worse than one that prints nothing. The interface shows the
 * string as it is. See the docstring on `raw.records` in 030_raw.sql.
 *
 * Counts are `::int` and byte totals `::float8`, so they arrive as numbers. The pinned
 * `int8`/`numeric` parsers return strings to keep MONEY out of floats (`.claude/rules/money.md`);
 * a row count or a byte total is a count, exact in a double to 2^53, and the cast says so
 * at the one place it happens.
 */

import type { SqlExecutor } from "@undercroft/db";
import { decodeCursor, encodeCursor } from "@undercroft/db/repos";

export interface RecordStreamSummary {
  readonly source: string;
  readonly entity: string;
  readonly records: number;
  /** Rows the source has since deleted, kept as tombstones. Part of `records`. */
  readonly tombstoned: number;
  readonly latestObservedAt: string;
}

export interface DocumentSummary {
  readonly source: string;
  readonly documents: number;
  readonly bytes: number;
  /**
   * How many of them an extract run could actually read into text.
   *
   * Reported beside the total rather than instead of it, because the gap between the two IS
   * the useful figure: 122 documents of which 55 are readable says what a run achieved and
   * what is still opaque, where either number alone says neither. Zero means the extract
   * verb has not run over this source yet -- not that nothing in it can be read.
   */
  readonly readable: number;
  readonly latestObservedAt: string;
}

export interface Page<T> {
  readonly items: T[];
  readonly nextCursor: string | null;
}

export interface RawRecord {
  readonly source: string;
  readonly entity: string;
  readonly sourceRecordId: string;
  /** Postgres's own rendering of the jsonb, pretty-printed. Never parsed here. */
  readonly payload: string;
  readonly contentSha256: string;
  readonly sourceUpdatedAt: string | null;
  readonly observedAt: string;
  readonly loadedAt: string;
  readonly runId: string;
  readonly deletedAt: string | null;
}

export interface RawDocument {
  readonly source: string;
  readonly documentId: string;
  readonly contentType: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly observedAt: string;
  readonly runId: string;
  readonly deletedAt: string | null;
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function isoOrNull(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

export async function summariseRecords(
  exec: SqlExecutor,
  tenantId: string,
): Promise<RecordStreamSummary[]> {
  const { rows } = await exec.query<{
    source: string;
    entity: string;
    records: number;
    tombstoned: number;
    latest_observed_at: Date | string;
  }>(
    `SELECT source, entity,
            count(*)::int AS records,
            count(deleted_at)::int AS tombstoned,
            max(observed_at) AS latest_observed_at
     FROM raw.records
     WHERE tenant_id = $1
     GROUP BY source, entity
     ORDER BY source, entity`,
    [tenantId],
  );
  return rows.map((r) => ({
    source: r.source,
    entity: r.entity,
    records: r.records,
    tombstoned: r.tombstoned,
    latestObservedAt: iso(r.latest_observed_at),
  }));
}

export async function summariseDocuments(
  exec: SqlExecutor,
  tenantId: string,
): Promise<DocumentSummary[]> {
  const { rows } = await exec.query<{
    source: string;
    documents: number;
    bytes: number;
    readable: number;
    latest_observed_at: Date | string;
  }>(
    // `readable` is how many of this source's documents an extract run could actually read.
    // A LEFT JOIN, so a source nobody has run the extract verb over counts zero rather than
    // disappearing: "we have not read these yet" and "we read them and got nothing" are
    // different facts, and the second one is a row with a `reason`.
    `SELECT d.source,
            count(*)::int AS documents,
            coalesce(sum(d.byte_length), 0)::float8 AS bytes,
            count(t.method)::int AS readable,
            max(d.observed_at) AS latest_observed_at
     FROM raw.documents d
     LEFT JOIN raw.document_text t
       ON t.source = d.source
      AND t.tenant_id = d.tenant_id
      AND t.document_id = d.document_id
     WHERE d.tenant_id = $1
     GROUP BY d.source
     ORDER BY d.source`,
    [tenantId],
  );
  return rows.map((r) => ({
    source: r.source,
    documents: r.documents,
    bytes: r.bytes,
    readable: r.readable,
    latestObservedAt: iso(r.latest_observed_at),
  }));
}

interface RecordRow {
  source: string;
  entity: string;
  source_record_id: string;
  payload: string;
  content_sha256: string;
  source_updated_at: Date | string | null;
  observed_at: Date | string;
  loaded_at: Date | string;
  run_id: string;
  deleted_at: Date | string | null;
}

const RECORD_COLUMNS = `source, entity, source_record_id, jsonb_pretty(payload) AS payload,
  content_sha256, source_updated_at, observed_at, loaded_at, run_id, deleted_at`;

function toRecord(r: RecordRow): RawRecord {
  return {
    source: r.source,
    entity: r.entity,
    sourceRecordId: r.source_record_id,
    payload: r.payload,
    contentSha256: r.content_sha256,
    sourceUpdatedAt: isoOrNull(r.source_updated_at),
    observedAt: iso(r.observed_at),
    loadedAt: iso(r.loaded_at),
    runId: r.run_id,
    deletedAt: isoOrNull(r.deleted_at),
  };
}

/**
 * One stream's rows, newest observation first, a page at a time.
 *
 * Keyed by `(observed_at, source_record_id)`: within one (tenant, source, entity) the
 * record id is unique, so the pair is a total order and a page boundary is exact.
 */
export async function listRecords(
  exec: SqlExecutor,
  tenantId: string,
  stream: { source: string; entity: string },
  page: { limit: number; cursor?: string | null },
): Promise<Page<RawRecord>> {
  const after = decodeCursor(page.cursor);
  const { rows } = await exec.query<RecordRow>(
    after === null
      ? `SELECT ${RECORD_COLUMNS} FROM raw.records
         WHERE tenant_id = $1 AND source = $2 AND entity = $3
         ORDER BY observed_at DESC, source_record_id DESC LIMIT $4`
      : `SELECT ${RECORD_COLUMNS} FROM raw.records
         WHERE tenant_id = $1 AND source = $2 AND entity = $3
           AND (observed_at, source_record_id) < ($5::timestamptz, $6)
         ORDER BY observed_at DESC, source_record_id DESC LIMIT $4`,
    after === null
      ? [tenantId, stream.source, stream.entity, page.limit + 1]
      : [tenantId, stream.source, stream.entity, page.limit + 1, after.at, after.id],
  );
  const items = rows.slice(0, page.limit).map(toRecord);
  const last = items.at(-1);
  const nextCursor =
    rows.length > page.limit && last !== undefined
      ? encodeCursor(last.observedAt, last.sourceRecordId)
      : null;
  return { items, nextCursor };
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
}

const DOCUMENT_COLUMNS = `source, document_id, content_type, byte_length::float8 AS bytes,
  sha256, observed_at, run_id, deleted_at`;

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
  };
}

/**
 * The document catalogue for one source, newest first, a page at a time.
 *
 * The catalogue row only: content type, size, digest, when. Not the bytes, which are in the
 * object store, and not `metadata` -- opaque provider ids by contract (ADR 0015), but the
 * contract is what keeps names out of it and a browser is not the place to test it.
 */
export async function listDocuments(
  exec: SqlExecutor,
  tenantId: string,
  source: string,
  page: { limit: number; cursor?: string | null },
): Promise<Page<RawDocument>> {
  const after = decodeCursor(page.cursor);
  const { rows } = await exec.query<DocumentRow>(
    after === null
      ? `SELECT ${DOCUMENT_COLUMNS} FROM raw.documents
         WHERE tenant_id = $1 AND source = $2
         ORDER BY observed_at DESC, document_id DESC LIMIT $3`
      : `SELECT ${DOCUMENT_COLUMNS} FROM raw.documents
         WHERE tenant_id = $1 AND source = $2
           AND (observed_at, document_id) < ($4::timestamptz, $5)
         ORDER BY observed_at DESC, document_id DESC LIMIT $3`,
    after === null
      ? [tenantId, source, page.limit + 1]
      : [tenantId, source, page.limit + 1, after.at, after.id],
  );
  const items = rows.slice(0, page.limit).map(toDocument);
  const last = items.at(-1);
  const nextCursor =
    rows.length > page.limit && last !== undefined
      ? encodeCursor(last.observedAt, last.documentId)
      : null;
  return { items, nextCursor };
}

/**
 * The operator's backfill of `raw.documents.file_name` and `source_url` for documents landed
 * before those columns existed. ADR 0161; the columns are `700_document_trace.sql`.
 *
 * A landing writes both itself (`rawDocuments.ts`). What came before has its name only in the
 * lake manifest of the observation that carried it, and its link only implied by its id, so the
 * backfill reads one and derives the other one layer up (`services/documentBytesPurge.ts`) and
 * writes them here.
 *
 * "UNTRACED" IS BOTH NULL. A row with either filled was written by a landing that knew, or by an
 * earlier backfill, and is never overwritten from an older manifest. A row neither can fill -- a
 * HubSpot note has no name and no derivable link -- stays untraced, and the keyset cursor below
 * is what lets one pass walk past it rather than read it forever.
 */

import type { SqlExecutor } from "@undercroft/db";

import type { DocumentIdentity } from "./rawDocuments.ts";

/** How many of a (tenant, source)'s documents carry neither a name nor a link. */
export interface UntracedScope extends DocumentIdentity {
  readonly documents: number;
}

export async function untracedScopes(
  exec: SqlExecutor,
  tenantId: string | null,
): Promise<UntracedScope[]> {
  const { rows } = await exec.query<{ tenant_id: string; source: string; documents: number }>(
    `SELECT tenant_id, source, count(*)::int AS documents
       FROM raw.documents
      WHERE file_name IS NULL AND source_url IS NULL
        AND ($1::text IS NULL OR tenant_id = $1)
      GROUP BY tenant_id, source
      ORDER BY tenant_id, source`,
    [tenantId],
  );
  return rows.map((row) => ({
    tenantId: row.tenant_id,
    source: row.source,
    documents: row.documents,
  }));
}

/** One untraced document, with what its trace is derived from. */
export interface UntracedDocument {
  readonly documentId: string;
  readonly lakeKey: string;
  readonly sha256: string;
  /** Opaque provider ids: `messageId`, `archiveDocumentId`, `part`. */
  readonly metadata: Readonly<Record<string, unknown>>;
}

/** The next page of a scope's untraced documents after `after`, by id. */
export async function untracedDocuments(
  exec: SqlExecutor,
  identity: DocumentIdentity,
  page: { readonly after: string | null; readonly limit: number },
): Promise<UntracedDocument[]> {
  const { rows } = await exec.query<{
    document_id: string;
    lake_key: string;
    sha256: string;
    metadata: Record<string, unknown> | null;
  }>(
    `SELECT document_id, lake_key, sha256, metadata
       FROM raw.documents
      WHERE source = $1 AND tenant_id = $2
        AND file_name IS NULL AND source_url IS NULL
        AND ($3::text IS NULL OR document_id > $3)
      ORDER BY document_id
      LIMIT $4`,
    [identity.source, identity.tenantId, page.after, page.limit],
  );
  return rows.map((row) => ({
    documentId: row.document_id,
    lakeKey: row.lake_key,
    sha256: row.sha256,
    metadata: row.metadata ?? {},
  }));
}

/** A trace to write: the name and link found for one document's current bytes. */
export interface Trace {
  readonly documentId: string;
  readonly sha256: string;
  readonly fileName: string | null;
  readonly sourceUrl: string | null;
}

/**
 * Write traces onto documents still untraced and still holding the bytes they were found for.
 * Returns how many rows changed. A document that landed new bytes meanwhile was traced by that
 * landing, and the name of its old bytes is not written over it.
 */
export async function writeTraces(
  exec: SqlExecutor,
  identity: DocumentIdentity,
  traces: readonly Trace[],
): Promise<number> {
  const found = traces.filter((trace) => trace.fileName !== null || trace.sourceUrl !== null);
  if (found.length === 0) {
    return 0;
  }
  const { rows } = await exec.query<{ document_id: string }>(
    `UPDATE raw.documents d SET file_name = v.fn, source_url = v.url
       FROM unnest($3::text[], $4::char(64)[], $5::text[], $6::text[]) AS v(did, sha, fn, url)
      WHERE d.source = $1 AND d.tenant_id = $2 AND d.document_id = v.did
        AND d.sha256 = v.sha
        AND d.file_name IS NULL AND d.source_url IS NULL
      RETURNING d.document_id`,
    [
      identity.source,
      identity.tenantId,
      found.map((trace) => trace.documentId),
      found.map((trace) => trace.sha256),
      found.map((trace) => trace.fileName),
      found.map((trace) => trace.sourceUrl),
    ],
  );
  return rows.length;
}

/**
 * Give each archive member with no link its archive's, as a landing does (ADR 0161): the source
 * holds the archive, not the member. Returns how many members it linked.
 */
export async function linkMembersToArchives(
  exec: SqlExecutor,
  identity: DocumentIdentity,
): Promise<number> {
  const { rows } = await exec.query<{ document_id: string }>(
    `UPDATE raw.documents m SET source_url = a.source_url
       FROM raw.documents a
      WHERE m.source = $1 AND m.tenant_id = $2
        AND a.source = m.source AND a.tenant_id = m.tenant_id
        AND a.document_id = m.metadata->>'archiveDocumentId'
        AND m.source_url IS NULL
        AND a.source_url IS NOT NULL
      RETURNING m.document_id`,
    [identity.source, identity.tenantId],
  );
  return rows.length;
}

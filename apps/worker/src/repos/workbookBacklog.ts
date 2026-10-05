/**
 * The workbooks whose rows are owed, and the rows no live document needs any more.
 * ADR 0104 decision 9; the tables are `460_document_rows.sql` and `470_document_rows_refusal.sql`.
 *
 * Its own module because it is its own backlog, as `documentLayout.ts` is. `documentText.ts`
 * owns what a pass has to READ for the first time; this owns the workbooks a pass READ BEFORE
 * their rows existed -- or under an older rows generation -- and must read again from the lake
 * to write them. Which methods those are, and which generation is current, is decided one layer
 * up (`services/extract/workbookRows.ts`) and arrives here as parameters.
 *
 * A TEXT READ FROM THE BYTES THE DOCUMENT STILL HAS, AND NOTHING ELSE. A document whose bytes
 * changed is the read backlog's (`PENDING_JOIN`), and its read writes rows anyway; a document
 * refused outright has no workbook to write. So the backlog is exactly: read as a workbook, from
 * these bytes, and no sheets of the current generation -- and no refusal under it either, which
 * is what stops a digest the reader now refuses from heading every batch for ever.
 */

import type { SqlExecutor } from "@undercroft/db";

import type { WorkbookKey } from "./documentRows.ts";

interface Scope {
  readonly tenantId: string;
  readonly source: string;
}

/** Which texts count as workbooks, and the rows generation being written. */
interface Owed {
  readonly methods: readonly string[];
  readonly rowsVersion: number;
}

/** A document to read again for its rows: one per digest. */
export interface OwedWorkbook {
  readonly documentId: string;
  readonly sha256: string;
  readonly lakeKey: string;
  readonly contentType: string;
}

/**
 * `$1` IS THE METHODS AND `$2` THE ROWS GENERATION IN BOTH STATEMENTS, so one string names them.
 * Scoped to a source because the extract run is (`ops.run` is one per tenant, source and verb);
 * the rows it writes are the digest's, so another source holding the same bytes finds them done.
 */
const OWED_JOIN = `FROM raw.documents d
       JOIN raw.document_text t
         ON t.source = d.source
        AND t.tenant_id = d.tenant_id
        AND t.document_id = d.document_id
      WHERE d.deleted_at IS NULL
        AND t.source_sha256 = d.sha256
        AND t.method = ANY($1::text[])
        AND NOT EXISTS (SELECT 1 FROM raw.document_sheets s
                         WHERE s.tenant_id = d.tenant_id AND s.sha256 = d.sha256
                           AND s.rows_version >= $2)
        AND NOT EXISTS (SELECT 1 FROM raw.document_rows_refusal f
                         WHERE f.tenant_id = d.tenant_id AND f.sha256 = d.sha256
                           AND f.rows_version >= $2)`;

/** This scope's workbooks owed their rows, one document per digest, digest order, capped. */
export async function owedWorkbooks(
  exec: SqlExecutor,
  scope: Scope,
  owed: Owed & { readonly limit: number },
): Promise<OwedWorkbook[]> {
  const { rows } = await exec.query<{
    document_id: string;
    sha256: string;
    lake_key: string;
    content_type: string;
  }>(
    `SELECT DISTINCT ON (d.sha256) d.document_id, d.sha256, d.lake_key, d.content_type
       ${OWED_JOIN}
        AND d.tenant_id = $3
        AND d.source = $4
      ORDER BY d.sha256, d.document_id
      LIMIT $5`,
    [owed.methods, owed.rowsVersion, scope.tenantId, scope.source, owed.limit],
  );
  return rows.map((row) => ({
    documentId: row.document_id,
    sha256: row.sha256,
    lakeKey: row.lake_key,
    contentType: row.content_type,
  }));
}

/** The pairs holding a workbook owed its rows: outstanding extract work, for the scheduler. */
export async function owedWorkbookScopes(exec: SqlExecutor, owed: Owed): Promise<Scope[]> {
  const { rows } = await exec.query<{ tenantId: string; source: string }>(
    `SELECT DISTINCT d.tenant_id AS "tenantId", d.source
       ${OWED_JOIN}
      ORDER BY 1, 2`,
    [owed.methods, owed.rowsVersion],
  );
  return rows.map((row) => ({ tenantId: row.tenantId, source: row.source }));
}

/** Record that the current reader refused this digest's rows, and why. */
export async function refuseWorkbookRows(
  exec: SqlExecutor,
  key: WorkbookKey,
  refusal: {
    readonly rowsVersion: number;
    readonly reason: string;
    readonly refusedAt: string;
    readonly runId: string;
  },
): Promise<void> {
  await exec.query(
    `INSERT INTO raw.document_rows_refusal (tenant_id, sha256, rows_version, reason, refused_at, run_id)
     VALUES ($1, $2, $3, $4, $5::timestamptz, $6)
     ON CONFLICT (tenant_id, sha256) DO UPDATE
        SET rows_version = excluded.rows_version,
            reason       = excluded.reason,
            refused_at   = excluded.refused_at,
            run_id       = excluded.run_id`,
    [
      key.tenantId,
      key.sha256,
      refusal.rowsVersion,
      refusal.reason,
      refusal.refusedAt,
      refusal.runId,
    ],
  );
}

/**
 * Remove the rows -- and any refusal -- of digests no live document of this tenant holds, up to
 * `limit` digests. Returns how many were removed.
 *
 * Per TENANT, across its sources: a ledger tombstoned in Gmail but still filed in Drive keeps its
 * rows. Bounded, so one pass after a large tombstoning does not hold the table for minutes; the
 * next pass takes the rest, and the count says how many went (`raw-lake.md`: retention bounded
 * and reported).
 */
export async function removeOrphanWorkbooks(
  exec: SqlExecutor,
  tenantId: string,
  limit: number,
): Promise<number> {
  const { rows } = await exec.query<{ removed: number }>(
    `WITH orphan AS (
       SELECT DISTINCT o.sha256
         FROM (SELECT sha256 FROM raw.document_sheets WHERE tenant_id = $1
               UNION
               SELECT sha256 FROM raw.document_rows_refusal WHERE tenant_id = $1) o
        WHERE NOT EXISTS (SELECT 1 FROM raw.documents d
                           WHERE d.tenant_id = $1 AND d.sha256 = o.sha256
                             AND d.deleted_at IS NULL)
        LIMIT $2
     ), sheets AS (
       DELETE FROM raw.document_sheets s USING orphan
        WHERE s.tenant_id = $1 AND s.sha256 = orphan.sha256
     ), refusals AS (
       DELETE FROM raw.document_rows_refusal f USING orphan
        WHERE f.tenant_id = $1 AND f.sha256 = orphan.sha256
     )
     SELECT count(*)::int AS removed FROM orphan`,
    [tenantId, limit],
  );
  return rows[0]?.removed ?? 0;
}

/**
 * Replace the text of every document of this tenant read as a workbook from these bytes, with a
 * text read from them again. Returns how many documents it answered.
 *
 * THE WORKBOOK BACKFILL'S HALF (ADR 0104 decision 9). A workbook read before rows existed was
 * read by an older reader, whose text slid a value left past an omitted cell; the backfill reads
 * the bytes again for their rows, and this brings the text to the same reading in the same
 * transaction. It is called only after that read SUCCEEDED, and it touches only a text that was
 * itself a successful workbook read (`methods`), from these exact bytes -- so it replaces one
 * reading with a newer one and never a text with nothing (the 2,602-document rule in `documentText.ts`).
 *
 * ACROSS THE TENANT'S SOURCES, NOT ONE. The rows are the digest's: the first source's pass to
 * reach a digest writes them, and the second source's backlog then finds it done. Scoped to one
 * source, that second source's copy would keep its slid text for ever. Same bytes, same reader,
 * same text -- and the tenant is still a bind parameter, never the data (`WRITE_BY_DIGEST` in `documentText.ts`).
 */
export async function rewriteWorkbookText(
  exec: SqlExecutor,
  key: { readonly tenantId: string; readonly sha256: string },
  reading: {
    readonly methods: readonly string[];
    readonly text: string;
    readonly truncated: boolean;
    readonly extractedAt: string;
    readonly runId: string;
  },
): Promise<number> {
  const { rows } = await exec.query<{ document_id: string }>(
    `UPDATE raw.document_text
        SET text = $4, chars = char_length($4), truncated = $5,
            extracted_at = $6::timestamptz, run_id = $7
      WHERE tenant_id = $1 AND source_sha256 = $2 AND method = ANY($3::text[])
      RETURNING document_id`,
    [
      key.tenantId,
      key.sha256,
      reading.methods,
      reading.text,
      reading.truncated,
      reading.extractedAt,
      reading.runId,
    ],
  );
  return rows.length;
}

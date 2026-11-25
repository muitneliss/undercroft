/**
 * Which documents' bytes may leave the lake, and the record that they did. ADR 0161; the columns
 * are `700_document_trace.sql`.
 *
 * THE UNIT IS A DIGEST, AND THE QUESTION IS ASKED OF EVERY HOLDER. The lake stores a blob once per
 * content (`packages/lake/src/store.ts`), so one `_blobs/` object can be named by documents in
 * several sources and several tenants. Deleting it removes it for all of them, so a digest is
 * purgeable only when NO document holding it -- anywhere -- still needs its bytes. That is why the
 * predicate below is correlated on `sha256` alone and carries no tenant: it reads every tenant's
 * rows (the worker holds `platform_all` on `raw.documents`) and WRITES only a timestamp, an
 * enumerated outcome and a report key, never content -- so the reason `WRITE_BY_DIGEST` in
 * `documentText.ts` refuses to cross tenants, copying one customer's text into another's row,
 * does not arise here.
 *
 * A DOCUMENT STILL NEEDS ITS BYTES -- is "unsettled" -- when its bytes are held and any of:
 *
 * - **no text was taken from these bytes**: never read, or read from bytes it has since replaced.
 *   This includes a document tombstoned before the extract pass reached it. The pass does not
 *   read what the source deleted, so its bytes are the only copy of a file nobody has read, and
 *   the owner's decision purges what extraction has ATTEMPTED; that file has not been.
 * - **its refusal is queued for the current readers**: refused by an older generation, live, and
 *   so in `PENDING_JOIN`'s backlog. A new reader must get its go before the bytes go.
 * - **it is a workbook owed its rows**: `OWED_JOIN`'s backlog (`workbookBacklog.ts`), read again
 *   from the lake to write them.
 *
 * Those are the two backlogs that read the lake, restated rather than shared: each is written in
 * its own module's parameter numbering for its own statements, and this one adds the tombstoned
 * case they deliberately leave out. What keeps them agreeing is the direction of the difference --
 * this is a SUPERSET of both, so a document either backlog would offer is never purged -- and
 * `runExtract.test.ts`, which pins that a document refused under an older reader keeps its bytes.
 * An archive needs no clause of its own: its members land in the same read that writes its text
 * (`runExtract.ts`, `readOne`), so a read archive has landed them.
 *
 * A purged document is settled by definition and never unsettles: its bytes are gone, so no
 * backlog may offer it again (both joins now say `bytes_purged_at IS NULL`).
 *
 * `$1` IS THE READER GENERATION, `$2` THE WORKBOOK METHODS, `$3` THE ROWS GENERATION AND `$4` THE
 * TABULAR TYPES in every statement here, so the fragments below can name them. Nothing here
 * decides what those are; they arrive from `services/extract/`.
 */

import type { SqlExecutor } from "@undercroft/db";

/** The generations whose backlogs a purge must not get ahead of. */
export interface Settlement {
  readonly readerVersion: number;
  readonly workbookMethods: readonly string[];
  readonly rowsVersion: number;
  readonly tabularTypes: readonly string[];
}

function settlementParams(s: Settlement): unknown[] {
  return [s.readerVersion, s.workbookMethods, s.rowsVersion, s.tabularTypes];
}

/** The text taken from the bytes a holder `h` has NOW; absent when none was. */
const TEXT_OF_THESE_BYTES = `LEFT JOIN raw.document_text t
         ON t.source = h.source
        AND t.tenant_id = h.tenant_id
        AND t.document_id = h.document_id
        AND t.source_sha256 = h.sha256`;

const UNREAD = "t.document_id IS NULL";

const REQUEUED = "(h.deleted_at IS NULL AND t.method IS NULL AND t.reader_version < $1)";

const ROWS_OWED = `(h.deleted_at IS NULL
        AND (t.method = ANY($2::text[])
             OR (t.method IS NOT NULL
                 AND lower(split_part(h.content_type, ';', 1)) = ANY($4::text[])))
        AND NOT EXISTS (SELECT 1 FROM raw.document_sheets s
                         WHERE s.tenant_id = h.tenant_id AND s.sha256 = h.sha256
                           AND s.rows_version >= $3)
        AND NOT EXISTS (SELECT 1 FROM raw.document_rows_refusal f
                         WHERE f.tenant_id = h.tenant_id AND f.sha256 = h.sha256
                           AND f.rows_version >= $3))`;

/** A holder `h`, matched by `correlation`, that still needs its bytes. Use under `EXISTS`. */
function unsettledHolder(correlation: string): string {
  return `SELECT 1 FROM raw.documents h
       ${TEXT_OF_THESE_BYTES}
      WHERE ${correlation}
        AND h.bytes_purged_at IS NULL
        AND (${UNREAD} OR ${REQUEUED} OR ${ROWS_OWED})`;
}

/** Whose documents a question is about: one source of a tenant, a whole tenant, or everyone. */
export interface PurgeScope {
  readonly tenantId: string | null;
  readonly source: string | null;
}

/** One digest whose every holder is settled, with its size as the catalogue recorded it. */
export interface PurgeableDigest {
  readonly sha256: string;
  /** Decimal digits, as `byte_length` is everywhere: a size is never rounded through a float. */
  readonly byteLength: string;
}

/**
 * Up to `limit` digests held by this scope's unpurged documents whose every holder, in any
 * tenant, is settled -- digest order, so a capped call resumes where the last stopped.
 */
export async function purgeableDigests(
  exec: SqlExecutor,
  scope: PurgeScope,
  settlement: Settlement & { readonly limit: number },
): Promise<PurgeableDigest[]> {
  const { rows } = await exec.query<{ sha256: string; byte_length: string }>(
    `SELECT x.sha256, max(x.byte_length)::text AS byte_length
       FROM raw.documents x
      WHERE x.bytes_purged_at IS NULL
        AND ($5::text IS NULL OR x.tenant_id = $5)
        AND ($6::text IS NULL OR x.source = $6)
        AND NOT EXISTS (${unsettledHolder("h.sha256 = x.sha256")})
      GROUP BY x.sha256
      ORDER BY x.sha256
      LIMIT $7`,
    [...settlementParams(settlement), scope.tenantId, scope.source, settlement.limit],
  );
  return rows.map((row) => ({ sha256: row.sha256, byteLength: row.byte_length }));
}

/** What a purge did to one digest, as `LakeStore.purgeBlobs` reported it. */
export interface DigestOutcome {
  readonly sha256: string;
  readonly outcome: "deleted" | "absent";
}

/**
 * Record, on every settled document holding these digests in any tenant, that its bytes are
 * gone. Returns how many documents it marked.
 *
 * EACH ROW IS ASKED AGAIN, not taken from the digest list: a document that landed holding one of
 * these digests after `purgeableDigests` answered is unsettled, and is left unmarked so the
 * extract pass still offers it. Its bytes may be gone with the blob -- the pass then records
 * `lake-object-unreadable` against it, with its reason, and the next purge marks it `absent`.
 * That is the narrow race ADR 0161 names; marking it purged instead would have hidden it.
 */
export async function recordPurge(
  exec: SqlExecutor,
  outcomes: readonly DigestOutcome[],
  record: Settlement & { readonly purgedAt: string; readonly report: string },
): Promise<number> {
  if (outcomes.length === 0) {
    return 0;
  }
  const { rows } = await exec.query<{ document_id: string }>(
    `UPDATE raw.documents x
        SET bytes_purged_at     = $5::timestamptz,
            bytes_purge_outcome = v.outcome,
            bytes_purge_report  = $6
       FROM unnest($7::char(64)[], $8::text[]) AS v(sha, outcome)
      WHERE x.sha256 = v.sha
        AND x.bytes_purged_at IS NULL
        AND NOT EXISTS (${unsettledHolder(
          "h.source = x.source AND h.tenant_id = x.tenant_id AND h.document_id = x.document_id",
        )})
      RETURNING x.document_id`,
    [
      ...settlementParams(record),
      record.purgedAt,
      record.report,
      outcomes.map((o) => o.sha256),
      outcomes.map((o) => o.outcome),
    ],
  );
  return rows.length;
}

/**
 * Every (tenant, source) holding a digest the purge could remove now: outstanding extract work,
 * for the scheduler, beside `pendingScopes` and `owedWorkbookScopes`. Without it a digest that
 * became purgeable after its scope's last pass -- its last holder was in another tenant -- would
 * keep its bytes until something else happened to start a run there.
 */
export async function purgeableScopes(
  exec: SqlExecutor,
  settlement: Settlement,
): Promise<{ tenantId: string; source: string }[]> {
  const { rows } = await exec.query<{ tenantId: string; source: string }>(
    `SELECT DISTINCT x.tenant_id AS "tenantId", x.source
       FROM raw.documents x
      WHERE x.bytes_purged_at IS NULL
        AND NOT EXISTS (${unsettledHolder("h.sha256 = x.sha256")})
      ORDER BY 1, 2`,
    settlementParams(settlement),
  );
  return rows.map((row) => ({ tenantId: row.tenantId, source: row.source }));
}

/** Why a document still holds its bytes, as the operator's report names it. */
export type KeptBecause =
  | "never-read"
  | "tombstoned-before-read"
  | "refused-by-older-reader"
  | "workbook-rows-owed"
  | "bytes-shared-with-unread";

/** One tenant's documents whose bytes are still held, and what a purge would do with them. */
export interface PurgeOutlook {
  readonly tenantId: string;
  /** Documents whose bytes are already gone. */
  readonly purged: number;
  /** Digests a purge would remove now, the documents holding them, and their bytes. */
  readonly purgeableDigests: number;
  readonly purgeableDocuments: number;
  /** Decimal digits: summed once per digest, never per row (`rawLake.ts` on why). */
  readonly purgeableBytes: string;
  /** The rest, by why. */
  readonly kept: readonly { readonly because: KeptBecause; readonly documents: number }[];
}

/**
 * What a purge would do to each tenant's documents, and why it would keep the rest -- the
 * operator's dry run, in one statement so its figures come from one snapshot.
 *
 * A held document is classified by its OWN state first, then -- settled itself -- by whether a
 * holder of the same bytes elsewhere is not, which is the only reason a settled document keeps
 * its bytes.
 */
export async function purgeOutlook(
  exec: SqlExecutor,
  tenantId: string | null,
  settlement: Settlement,
): Promise<PurgeOutlook[]> {
  const { rows } = await exec.query<{
    tenant_id: string;
    purged: number;
    digests: number;
    documents: number;
    bytes: string;
    kept: { because: KeptBecause; documents: number }[] | null;
  }>(
    `WITH own AS (
       SELECT h.tenant_id, h.sha256, h.byte_length, h.bytes_purged_at IS NOT NULL AS purged,
              CASE WHEN h.bytes_purged_at IS NOT NULL THEN NULL
                   WHEN ${UNREAD} AND h.deleted_at IS NULL THEN 'never-read'
                   WHEN ${UNREAD} THEN 'tombstoned-before-read'
                   WHEN ${REQUEUED} THEN 'refused-by-older-reader'
                   WHEN ${ROWS_OWED} THEN 'workbook-rows-owed'
              END AS because
         FROM raw.documents h
         ${TEXT_OF_THESE_BYTES}
        WHERE ($5::text IS NULL OR h.tenant_id = $5)
     ), classified AS (
       SELECT c.tenant_id, c.sha256, c.byte_length, c.purged,
              CASE WHEN c.purged OR c.because IS NOT NULL THEN c.because
                   WHEN EXISTS (${unsettledHolder("h.sha256 = c.sha256")})
                     THEN 'bytes-shared-with-unread'
              END AS because
         FROM own c
     ), purgeable AS (
       SELECT tenant_id, count(DISTINCT sha256)::int AS digests, count(*)::int AS documents
         FROM classified WHERE NOT purged AND because IS NULL
        GROUP BY tenant_id
     ), purgeable_bytes AS (
       SELECT tenant_id, sum(byte_length)::text AS bytes
         FROM (SELECT DISTINCT tenant_id, sha256, byte_length
                 FROM classified WHERE NOT purged AND because IS NULL) d
        GROUP BY tenant_id
     ), kept AS (
       SELECT tenant_id,
              json_agg(json_build_object('because', because, 'documents', n)
                       ORDER BY n DESC, because) AS kept
         FROM (SELECT tenant_id, because, count(*)::int AS n
                 FROM classified WHERE because IS NOT NULL
                GROUP BY tenant_id, because) k
        GROUP BY tenant_id
     ), tenants AS (
       SELECT tenant_id, count(*) FILTER (WHERE purged)::int AS purged
         FROM classified GROUP BY tenant_id
     )
     SELECT t.tenant_id, t.purged,
            coalesce(p.digests, 0) AS digests, coalesce(p.documents, 0) AS documents,
            coalesce(b.bytes, '0') AS bytes, k.kept
       FROM tenants t
       LEFT JOIN purgeable p USING (tenant_id)
       LEFT JOIN purgeable_bytes b USING (tenant_id)
       LEFT JOIN kept k USING (tenant_id)
      ORDER BY t.tenant_id`,
    [...settlementParams(settlement), tenantId],
  );
  return rows.map((row) => ({
    tenantId: row.tenant_id,
    purged: row.purged,
    purgeableDigests: row.digests,
    purgeableDocuments: row.documents,
    purgeableBytes: row.bytes,
    kept: row.kept ?? [],
  }));
}

/**
 * `raw.document_text` laid out again: the texts written under an older layout generation, and
 * the write that brings each one to the current generation.
 *
 * Its own module because it is its own backlog. `documentText.ts` owns what a pass has to READ,
 * from the lake; this owns what a pass can lay out again FROM THE TEXT ALONE, and never offers a
 * document's bytes. The two share the table and nothing else, and folding them together would
 * put a second meaning of "pending" beside `PENDING_JOIN`. The stamp is
 * `370_document_text_layout_version.sql`'s; which methods may be laid out again, and how, is
 * decided one layer up (`services/extract/extractText.ts`). ADR 0081.
 */

import type { SqlExecutor } from "@undercroft/db";

import type { ExtractStamp } from "./documentText.ts";

interface Scope {
  readonly tenantId: string;
  readonly source: string;
}

/**
 * "A live document's text, read by one of `methods` from the bytes it still has, and written
 * under a layout generation older than `layoutVersion`."
 *
 * The re-layout's backlog, apart from the read backlog on purpose. `PENDING_JOIN` offers a
 * document to be READ, from the lake; this offers a TEXT to be laid out again from itself, and
 * never the bytes. A text read from bytes that have since changed is left out here because the
 * read backlog already has it, and a read writes the current layout anyway.
 *
 * `$1` IS THE METHODS AND `$2` THE GENERATION IN ALL THREE STATEMENTS, as `$1` is the reader
 * generation in `PENDING_JOIN`'s, so one string can name them.
 */
const STALE_LAYOUT = `FROM raw.document_text t
       JOIN raw.documents d
         ON d.source = t.source
        AND d.tenant_id = t.tenant_id
        AND d.document_id = t.document_id
      WHERE d.deleted_at IS NULL
        AND t.source_sha256 = d.sha256
        AND t.method = ANY($1::text[])
        AND t.layout_version < $2`;

/** Which methods may be laid out again, and the generation being laid out to. */
interface Layout {
  readonly methods: readonly string[];
  readonly layoutVersion: number;
}

/** A stored text, as a re-layout needs it. */
export interface StoredText {
  readonly documentId: string;
  readonly sourceSha256: string;
  readonly method: string;
  readonly text: string;
}

/** One text looked at by a re-layout: its new text, or `null` when it stays as it is. */
export interface RelaidText {
  readonly documentId: string;
  readonly sourceSha256: string;
  readonly text: string | null;
  readonly truncated: boolean;
}

/** The texts of this scope written under an older layout, oldest-keyed first, capped. */
export async function staleLayouts(
  exec: SqlExecutor,
  scope: Scope,
  { methods, layoutVersion, limit }: Layout & { readonly limit: number },
): Promise<StoredText[]> {
  const { rows } = await exec.query<{
    document_id: string;
    source_sha256: string;
    method: string;
    text: string;
  }>(
    `SELECT t.document_id, t.source_sha256, t.method, t.text
       ${STALE_LAYOUT}
        AND t.source = $3
        AND t.tenant_id = $4
      ORDER BY t.document_id
      LIMIT $5`,
    [methods, layoutVersion, scope.source, scope.tenantId, limit],
  );
  return rows.map((row) => ({
    documentId: row.document_id,
    sourceSha256: row.source_sha256,
    method: row.method,
    text: row.text,
  }));
}

/** Every (tenant, source) pair holding such a text: the scheduler's other reason to start a run. */
export async function staleLayoutScopes(exec: SqlExecutor, layout: Layout): Promise<Scope[]> {
  const { rows } = await exec.query<{ tenantId: string; source: string }>(
    `SELECT DISTINCT t.tenant_id AS "tenantId", t.source
       ${STALE_LAYOUT}
      ORDER BY 1, 2`,
    [layout.methods, layout.layoutVersion],
  );
  return rows.map((row) => ({ tenantId: row.tenantId, source: row.source }));
}

/**
 * Stamp every text looked at with the current layout, and replace those that changed.
 *
 * A TEXT THAT STAYS KEEPS ITS WHOLE ROW BUT THE STAMP -- its words, its `extracted_at` and its
 * `run_id` -- because nothing about it was read or written again; only a changed text carries
 * this run. Stamping the unchanged ones is not bookkeeping: it is what takes a document from
 * another issuer, which will never become a profile, out of the backlog after one look instead
 * of offering it to every run for ever.
 *
 * Guarded by `source_sha256` and the older stamp, so a read that lands between the look and
 * this write -- from new bytes, or already in the current layout -- is never overwritten by a
 * layout of the text it replaced. Returns how many texts changed.
 */
export async function relayTexts(
  exec: SqlExecutor,
  scope: Scope,
  rows: readonly RelaidText[],
  stamp: Omit<ExtractStamp, "readerVersion">,
): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }
  const written = await exec.query<{ changed: boolean }>(
    `UPDATE raw.document_text t
        SET layout_version = $3::integer,
            text           = COALESCE(p.text, t.text),
            chars          = char_length(COALESCE(p.text, t.text)),
            truncated      = CASE WHEN p.text IS NULL THEN t.truncated ELSE p.truncated END,
            extracted_at   = CASE WHEN p.text IS NULL THEN t.extracted_at ELSE $4::timestamptz END,
            run_id         = CASE WHEN p.text IS NULL THEN t.run_id ELSE $5 END
       FROM unnest($6::text[], $7::text[], $8::text[], $9::boolean[])
         AS p(document_id, source_sha256, text, truncated)
      WHERE t.source = $1
        AND t.tenant_id = $2
        AND t.document_id = p.document_id
        AND t.source_sha256 = p.source_sha256
        AND t.layout_version < $3::integer
      RETURNING p.text IS NOT NULL AS changed`,
    [
      scope.source,
      scope.tenantId,
      stamp.layoutVersion,
      stamp.extractedAt,
      stamp.runId,
      rows.map((r) => r.documentId),
      rows.map((r) => r.sourceSha256),
      rows.map((r) => r.text),
      rows.map((r) => r.truncated),
    ],
  );
  return written.rows.filter((row) => row.changed).length;
}

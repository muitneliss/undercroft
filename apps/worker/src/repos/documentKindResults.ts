/**
 * `raw.document_kind` and `raw.document_kind_definition`: what each text was classified as, and
 * which published catalogue that answer is measured against. ADR 0085.
 *
 * ONE PREDICATE FOR "DUE", used by the scheduler's list and by the run's batch alike -- the rule
 * `documentText.ts` keeps with `PENDING_JOIN` and for the same reason: two definitions drifting
 * apart is a flow that ticks for ever over a pair whose run then finds nothing to do. A digest is
 * due when the tenant has a published catalogue and the digest has no answer to it: no row, a row
 * answering an older hash, or a provider error, which is retried. `too-short` and
 * `invalid-response` under the current hash are answers, and are not asked again.
 *
 * BY DIGEST, within the tenant. A forwarded attachment is many documents over one set of bytes,
 * and one answer serves them all -- which is also why the key is (tenant, digest) and not the
 * source: the same bytes in a second source are already answered.
 */

import type { SqlExecutor } from "@undercroft/db";

/** The newest published version of each tenant, as a derived table named `latest`. */
const LATEST = `(SELECT DISTINCT ON (tenant_id) tenant_id, version, definition_hash, published_at
                   FROM app.document_kind_version
                  ORDER BY tenant_id, version DESC) AS latest`;

/**
 * Readable, live texts whose digest has no answer to the tenant's current catalogue. `$1` is the
 * tenant in the batch's use; the scheduler's list joins every tenant instead.
 */
const DUE_JOIN = `FROM raw.document_text t
       JOIN raw.documents d
         ON d.source = t.source
        AND d.tenant_id = t.tenant_id
        AND d.document_id = t.document_id
        AND d.deleted_at IS NULL
       JOIN ${LATEST} ON latest.tenant_id = t.tenant_id
       LEFT JOIN raw.document_kind k
         ON k.tenant_id = t.tenant_id
        AND k.source_sha256 = t.source_sha256
      WHERE t.method IS NOT NULL
        AND t.chars > 0
        AND (k.tenant_id IS NULL
          OR k.definition_hash <> latest.definition_hash
          OR k.status = 'provider-error')`;

export interface SemanticScope {
  readonly tenantId: string;
  readonly source: string;
}

/** Every (tenant, source) pair with a text due, for the scheduler. */
export async function semanticDueScopes(exec: SqlExecutor): Promise<SemanticScope[]> {
  const { rows } = await exec.query<{ tenant_id: string; source: string }>(
    `SELECT DISTINCT t.tenant_id, t.source ${DUE_JOIN} ORDER BY 1, 2`,
  );
  return rows.map((row) => ({ tenantId: row.tenant_id, source: row.source }));
}

export interface CurrentDefinition {
  readonly version: number;
  readonly definitionHash: string;
  readonly definition: unknown;
  readonly publishedAt: string;
}

/** The tenant's newest published catalogue, or `null` before its first publish. */
export async function currentDefinition(
  exec: SqlExecutor,
  tenantId: string,
): Promise<CurrentDefinition | null> {
  const { rows } = await exec.query<{
    version: number;
    definition_hash: string;
    definition: unknown;
    published_at: Date | string;
  }>(
    `SELECT version, definition_hash, definition, published_at
       FROM app.document_kind_version WHERE tenant_id = $1 ORDER BY version DESC LIMIT 1`,
    [tenantId],
  );
  const [row] = rows;
  return row === undefined
    ? null
    : {
        version: row.version,
        definitionHash: row.definition_hash,
        definition: row.definition,
        publishedAt: new Date(row.published_at).toISOString(),
      };
}

/** Copy the current version into `raw`, where a tenant's dbt login can see which answers count. */
export async function syncDefinition(
  exec: SqlExecutor,
  tenantId: string,
  current: CurrentDefinition,
): Promise<void> {
  await exec.query(
    `INSERT INTO raw.document_kind_definition (tenant_id, version, definition_hash, published_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id) DO UPDATE
        SET version = excluded.version, definition_hash = excluded.definition_hash,
            published_at = excluded.published_at, synced_at = now()`,
    [tenantId, current.version, current.definitionHash, current.publishedAt],
  );
}

export interface DueText {
  readonly digest: string;
  readonly chars: number;
  /** Cut to the run's `maxChars` in SQL, so a long extraction never crosses the wire whole. */
  readonly text: string;
}

/** A batch of one pair's due texts, one per digest, oldest-extracted first. */
export async function dueTexts(
  exec: SqlExecutor,
  scope: SemanticScope,
  { limit, maxChars }: { readonly limit: number; readonly maxChars: number },
): Promise<DueText[]> {
  const { rows } = await exec.query<{ source_sha256: string; chars: number; text: string }>(
    `SELECT source_sha256, chars, text FROM (
       SELECT DISTINCT ON (t.source_sha256) t.source_sha256, t.chars, left(t.text, $4) AS text,
              t.extracted_at
         ${DUE_JOIN}
          AND t.tenant_id = $1 AND t.source = $2
        ORDER BY t.source_sha256, t.extracted_at) AS due
      ORDER BY extracted_at, source_sha256
      LIMIT $3`,
    [scope.tenantId, scope.source, limit, maxChars],
  );
  return rows.map((row) => ({ digest: row.source_sha256, chars: row.chars, text: row.text }));
}

/** How many digests of the pair are due in all, not only in this batch. */
export async function countDueTexts(exec: SqlExecutor, scope: SemanticScope): Promise<number> {
  const { rows } = await exec.query<{ n: string }>(
    `SELECT count(DISTINCT t.source_sha256)::text AS n ${DUE_JOIN}
        AND t.tenant_id = $1 AND t.source = $2`,
    [scope.tenantId, scope.source],
  );
  return Number.parseInt(rows[0]?.n ?? "0", 10);
}

export type KindStatus = "classified" | "too-short" | "invalid-response" | "provider-error";

export interface KindResult {
  readonly digest: string;
  readonly status: KindStatus;
  readonly kind: string | null;
  /** Four places as text, never a float carried into SQL. */
  readonly confidence: string | null;
  readonly probabilities: Readonly<Record<string, string>> | null;
  readonly reason: string | null;
}

/** Write a batch of answers, replacing whatever the digests held before. */
export async function upsertKindResults(
  exec: SqlExecutor,
  tenantId: string,
  stamp: { definitionHash: string; version: number; model: string; runId: string },
  results: readonly KindResult[],
): Promise<void> {
  if (results.length === 0) {
    return;
  }
  await exec.query(
    `INSERT INTO raw.document_kind (tenant_id, source_sha256, definition_hash, version, status,
       kind, confidence, probabilities, model, reason, classified_at, run_id)
     SELECT $1, r.digest, $2, $3, r.status, r.kind, r.confidence::numeric, r.probabilities::jsonb,
            $4, r.reason, now(), $5
       FROM unnest($6::text[], $7::text[], $8::text[], $9::text[], $10::text[], $11::text[])
            AS r(digest, status, kind, confidence, probabilities, reason)
     ON CONFLICT (tenant_id, source_sha256) DO UPDATE
        SET definition_hash = excluded.definition_hash, version = excluded.version,
            status = excluded.status, kind = excluded.kind, confidence = excluded.confidence,
            probabilities = excluded.probabilities, model = excluded.model,
            reason = excluded.reason, classified_at = excluded.classified_at,
            run_id = excluded.run_id`,
    [
      tenantId,
      stamp.definitionHash,
      stamp.version,
      stamp.model,
      stamp.runId,
      results.map((r) => r.digest),
      results.map((r) => r.status),
      results.map((r) => r.kind),
      results.map((r) => r.confidence),
      results.map((r) => (r.probabilities === null ? null : JSON.stringify(r.probabilities))),
      results.map((r) => r.reason),
    ],
  );
}

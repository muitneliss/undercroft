/**
 * `app.document_kind` and `app.document_kind_version`: a tenant's catalogue of document kinds
 * as its admin edits it, and the versions of it that were published. ADR 0085.
 *
 * Shared by both apps, as `models.ts` is: the control plane edits and publishes, the worker reads
 * the published version it classifies against and writes the first catalogue when it initialises
 * one. Nothing here decides anything -- which kinds may be removed, when a publish is a new
 * version, what a definition hashes to -- those are the control plane's service's to say.
 */

import type { SqlExecutor } from "../executor.ts";

export type DocumentKindOrigin = "initialised" | "generic" | "admin";

export interface CatalogueKind {
  readonly kind: string;
  readonly description: string;
  readonly origin: DocumentKindOrigin;
  /** The share of the initialising sample, as Postgres renders `numeric`; `null` if unmeasured. */
  readonly sampleShare: string | null;
  readonly updatedBy: string;
  readonly updatedAt: string;
}

export interface PublishedVersion {
  readonly version: number;
  readonly definitionHash: string;
  /** The canonical definition the hash is over, exactly as it was published. */
  readonly definition: unknown;
  readonly publishedBy: string;
  readonly publishedAt: string;
}

interface KindRow {
  kind: string;
  description: string;
  origin: DocumentKindOrigin;
  sample_share: string | null;
  updated_by: string;
  updated_at: Date | string;
}

interface VersionRow {
  version: number;
  definition_hash: string;
  definition: unknown;
  published_by: string;
  published_at: Date | string;
}

function toKind(row: KindRow): CatalogueKind {
  return {
    kind: row.kind,
    description: row.description,
    origin: row.origin,
    sampleShare: row.sample_share,
    updatedBy: row.updated_by,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function toVersion(row: VersionRow): PublishedVersion {
  return {
    version: row.version,
    definitionHash: row.definition_hash,
    definition: row.definition,
    publishedBy: row.published_by,
    publishedAt: new Date(row.published_at).toISOString(),
  };
}

/** The tenant's catalogue as it is being edited, by kind. */
export async function listKinds(exec: SqlExecutor, tenantId: string): Promise<CatalogueKind[]> {
  const { rows } = await exec.query<KindRow>(
    `SELECT kind, description, origin, sample_share::text AS sample_share, updated_by, updated_at
       FROM app.document_kind WHERE tenant_id = $1 ORDER BY kind`,
    [tenantId],
  );
  return rows.map(toKind);
}

/** Add kinds. A kind the tenant already has is left as it is; the answer is how many were new. */
export async function insertKinds(
  exec: SqlExecutor,
  tenantId: string,
  kinds: readonly {
    kind: string;
    description: string;
    origin: DocumentKindOrigin;
    sampleShare: string | null;
  }[],
  updatedBy: string,
): Promise<number> {
  if (kinds.length === 0) {
    return 0;
  }
  const { rows } = await exec.query<{ kind: string }>(
    `INSERT INTO app.document_kind (tenant_id, kind, description, origin, sample_share, updated_by)
     SELECT $1, k.kind, k.description, k.origin, k.share::numeric, $6
       FROM unnest($2::text[], $3::text[], $4::text[], $5::text[]) AS k(kind, description, origin, share)
     ON CONFLICT (tenant_id, kind) DO NOTHING
     RETURNING kind`,
    [
      tenantId,
      kinds.map((k) => k.kind),
      kinds.map((k) => k.description),
      kinds.map((k) => k.origin),
      kinds.map((k) => k.sampleShare),
      updatedBy,
    ],
  );
  return rows.length;
}

/** Rewrite one kind's description. `false` when the tenant has no such kind. */
export async function updateKindDescription(
  exec: SqlExecutor,
  tenantId: string,
  kind: string,
  description: string,
  updatedBy: string,
): Promise<boolean> {
  const { rows } = await exec.query<{ kind: string }>(
    `UPDATE app.document_kind SET description = $3, updated_by = $4, updated_at = now()
      WHERE tenant_id = $1 AND kind = $2 RETURNING kind`,
    [tenantId, kind, description, updatedBy],
  );
  return rows.length > 0;
}

/** Remove one kind. `false` when the tenant has no such kind. */
export async function deleteKind(
  exec: SqlExecutor,
  tenantId: string,
  kind: string,
): Promise<boolean> {
  const { rows } = await exec.query<{ kind: string }>(
    "DELETE FROM app.document_kind WHERE tenant_id = $1 AND kind = $2 RETURNING kind",
    [tenantId, kind],
  );
  return rows.length > 0;
}

/** The tenant's newest published version, or `null` before its first publish. */
export async function latestVersion(
  exec: SqlExecutor,
  tenantId: string,
): Promise<PublishedVersion | null> {
  const { rows } = await exec.query<VersionRow>(
    `SELECT version, definition_hash, definition, published_by, published_at
       FROM app.document_kind_version WHERE tenant_id = $1 ORDER BY version DESC LIMIT 1`,
    [tenantId],
  );
  const [row] = rows;
  return row === undefined ? null : toVersion(row);
}

/**
 * Publish a definition as the next version. The number is taken in the statement, and two
 * publishes racing for it meet the primary key rather than both succeeding.
 */
export async function insertVersion(
  exec: SqlExecutor,
  tenantId: string,
  version: { definitionHash: string; definitionJson: string; publishedBy: string },
): Promise<PublishedVersion> {
  const { rows } = await exec.query<VersionRow>(
    `INSERT INTO app.document_kind_version (tenant_id, version, definition_hash, definition, published_by)
     SELECT $1, COALESCE(max(version), 0) + 1, $2, $3::jsonb, $4
       FROM app.document_kind_version WHERE tenant_id = $1
     RETURNING version, definition_hash, definition, published_by, published_at`,
    [tenantId, version.definitionHash, version.definitionJson, version.publishedBy],
  );
  const [row] = rows;
  if (row === undefined) {
    throw new Error("publishing a document-kind version returned no row");
  }
  return toVersion(row);
}

/**
 * How many of the tenant's live documents have text to classify: an upper bound on a publish's
 * calls, since documents sharing their bytes are classified once. Counted from the columns the
 * control plane may read of `raw.document_text` -- never `text`, never the digest.
 */
export async function countReadableDocuments(exec: SqlExecutor, tenantId: string): Promise<number> {
  const { rows } = await exec.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM raw.document_text
      WHERE tenant_id = $1 AND method IS NOT NULL AND chars > 0`,
    [tenantId],
  );
  return Number.parseInt(rows[0]?.n ?? "0", 10);
}

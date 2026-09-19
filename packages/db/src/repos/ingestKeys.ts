/**
 * `app.ingest_key`: the per-tenant keys that may push into the lake API.
 *
 * A read by DIGEST, never by id. The `id` prefix a caller might present is not part of the
 * lookup: the sha-256 of the token IS the credential, so a row is found by what the caller
 * proved it holds and by nothing it merely claims.
 *
 * Everything the key's validity depends on -- revocation, expiry, tenant, source scope --
 * comes back as it is stored. Deciding what that means is the worker's `services/auth.ts`,
 * which compares in constant time and answers with an outcome; a repo that returned `false`
 * here would be answering an authorization question from inside a SELECT.
 *
 * Shared between the worker, which admits callers and notes when a key was used, and the
 * control plane, which mints, lists, revokes and warns about them.
 */

import type { SqlExecutor } from "../executor.ts";

export interface IngestKeyRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly allowed_sources: string[];
  readonly expires_at: string | null;
  readonly revoked_at: string | null;
}

/** The key with this digest, or `null` when no such key exists. */
export async function findByDigest(
  exec: SqlExecutor,
  digest: string,
): Promise<IngestKeyRow | null> {
  const { rows } = await exec.query<IngestKeyRow>(
    `SELECT id, tenant_id, allowed_sources, expires_at, revoked_at
     FROM app.ingest_key WHERE token_sha256 = $1`,
    [digest],
  );
  return rows[0] ?? null;
}

/** Record that a key admitted a caller at `at`. The one column the worker may write. */
export async function touchLastUsed(exec: SqlExecutor, id: string, at: Date): Promise<void> {
  await exec.query("UPDATE app.ingest_key SET last_used_at = $2 WHERE id = $1", [
    id,
    at.toISOString(),
  ]);
}

/** A key as the Sources leaf lists it. Never the digest, never the token. */
export interface IngestKey {
  readonly id: string;
  readonly label: string;
  /** Empty means every source. */
  readonly allowedSources: string[];
  readonly createdAt: string;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
  readonly lastUsedAt: string | null;
}

function iso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

export async function listKeys(exec: SqlExecutor, tenantId: string): Promise<IngestKey[]> {
  const { rows } = await exec.query<{
    id: string;
    label: string;
    allowed_sources: string[];
    created_at: Date | string;
    expires_at: Date | string | null;
    revoked_at: Date | string | null;
    last_used_at: Date | string | null;
  }>(
    `SELECT id, label, allowed_sources, created_at, expires_at, revoked_at, last_used_at
     FROM app.ingest_key WHERE tenant_id = $1 ORDER BY created_at DESC, id`,
    [tenantId],
  );
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    allowedSources: row.allowed_sources,
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: iso(row.expires_at),
    revokedAt: iso(row.revoked_at),
    lastUsedAt: iso(row.last_used_at),
  }));
}

/** Store a freshly minted key. The digest, never the token: the token exists only in the caller's hands. */
export async function insertKey(
  exec: SqlExecutor,
  input: {
    id: string;
    tokenDigest: string;
    tenantId: string;
    label: string;
    allowedSources: string[];
    expiresAt: string | null;
  },
): Promise<void> {
  await exec.query(
    `INSERT INTO app.ingest_key (id, token_sha256, tenant_id, allowed_sources, label, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      input.id,
      input.tokenDigest,
      input.tenantId,
      input.allowedSources,
      input.label,
      input.expiresAt,
    ],
  );
}

/**
 * Revoke a live key of this tenant. `false` when there was none to revoke -- another
 * tenant's id, an unknown one, or one already revoked -- so a caller cannot learn which.
 */
export async function revokeKey(exec: SqlExecutor, tenantId: string, id: string): Promise<boolean> {
  const { rows } = await exec.query<{ id: string }>(
    `UPDATE app.ingest_key SET revoked_at = now()
     WHERE tenant_id = $1 AND id = $2 AND revoked_at IS NULL
     RETURNING id`,
    [tenantId, id],
  );
  return rows.length > 0;
}

/** A key about to expire, as the warning names it. Never the token, which is stored as a digest. */
export interface ExpiringKey {
  readonly id: string;
  readonly tenantId: string;
  readonly label: string;
  readonly expiresAt: string;
}

/**
 * Claim every live key expiring within `withinDays` that has not been warned about. One
 * UPDATE that marks and returns, for the reason `claimExpiringGrants` gives.
 */
export async function claimExpiringKeys(
  exec: SqlExecutor,
  withinDays: number,
): Promise<ExpiringKey[]> {
  const { rows } = await exec.query<{
    id: string;
    tenant_id: string;
    label: string;
    expires_at: Date | string;
  }>(
    `UPDATE app.ingest_key SET warned_at = now()
     WHERE expires_at IS NOT NULL AND warned_at IS NULL AND revoked_at IS NULL
       AND expires_at > now()
       AND expires_at <= now() + make_interval(days => $1::int)
     RETURNING id, tenant_id, label, expires_at`,
    [withinDays],
  );
  return rows.map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    label: row.label,
    expiresAt: new Date(row.expires_at).toISOString(),
  }));
}

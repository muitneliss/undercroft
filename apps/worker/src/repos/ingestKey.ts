/**
 * `app.ingest_key`: the per-tenant keys that may push into the lake API.
 *
 * A read by DIGEST, never by id. The `id` prefix a caller might present is not part of the
 * lookup: the sha-256 of the token IS the credential, so a row is found by what the caller
 * proved it holds and by nothing it merely claims.
 *
 * Everything the key's validity depends on -- revocation, expiry, tenant, source scope --
 * comes back as it is stored. Deciding what that means is `../services/auth.ts`, which
 * compares in constant time and answers with an outcome; a repo that returned `false` here
 * would be answering an authorization question from inside a SELECT.
 */

import type { SqlExecutor } from "@undercroft/db";

export interface IngestKeyRow {
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
    `SELECT tenant_id, allowed_sources, expires_at, revoked_at
     FROM app.ingest_key WHERE token_sha256 = $1`,
    [digest],
  );
  return rows[0] ?? null;
}

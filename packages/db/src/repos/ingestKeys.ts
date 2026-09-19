/**
 * `app.ingest_key`: the per-tenant keys that may push into the lake API.
 *
 * Shared between the worker, which reads a key by digest to admit a caller, and the control
 * plane, which warns about one that is about to expire. The worker's own read stays in its
 * repo for now; what lives here is the part both sides need.
 */

// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys, HTTP header names, and Better Auth's option keys and table names. strictCase cannot be satisfied by code that talks to another system.

import type { SqlExecutor } from "../executor.ts";

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

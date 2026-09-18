/**
 * Authenticating a caller of the lake write API.
 *
 * Two credential kinds, both compared in constant time:
 *
 * - the service token (`UNDERCROFT_TRIGGER_TOKEN`), which Kestra and the control plane
 *   present -- all tenants, all sources;
 * - a per-tenant ingest key stored as a SHA-256 digest in `app.ingest_key`, scoped to a
 *   tenant and optionally to a set of sources.
 *
 * A scoped key used outside its scope gets `out_of_scope` (403), not 404: the caller is a
 * machine with an explicit grant, and telling it plainly is actionable. The 404-not-403
 * enumeration defence belongs to the browser surface, not here.
 */

import { timingSafeEqual } from "node:crypto";
import { hashToken } from "@undercroft/crypto";
import type { SqlExecutor } from "@undercroft/db";
import { findByDigest, type IngestKeyRow } from "../repos/ingestKey.ts";

export type { IngestKeyRow };

export type AuthOutcome =
  | { ok: true; scope: "service" | { tenantId: string } }
  | { ok: false; code: "unauthenticated" | "out_of_scope"; message: string };

function constantTimeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.byteLength !== bb.byteLength) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Resolve a bearer token to what it may do. `serviceToken` is the shared trigger token;
 * an empty one disables service auth (tests that only exercise ingest keys).
 */
export async function authenticate(
  exec: SqlExecutor,
  bearer: string | null,
  opts: { serviceToken: string; tenantId: string; source: string; now?: Date },
): Promise<AuthOutcome> {
  if (bearer === null || bearer === "") {
    return { ok: false, code: "unauthenticated", message: "a bearer token is required" };
  }

  if (opts.serviceToken !== "" && constantTimeEquals(bearer, opts.serviceToken)) {
    return { ok: true, scope: "service" };
  }

  // Look the key up by its digest. The `id` prefix is not required to match; the digest
  // is the credential.
  const key = await findByDigest(exec, hashToken(bearer));
  if (key === null) {
    return { ok: false, code: "unauthenticated", message: "unknown or invalid token" };
  }

  const now = opts.now ?? new Date();
  if (key.revoked_at !== null) {
    return { ok: false, code: "unauthenticated", message: "token has been revoked" };
  }
  if (key.expires_at !== null && new Date(key.expires_at).getTime() <= now.getTime()) {
    return { ok: false, code: "unauthenticated", message: "token has expired" };
  }
  if (key.tenant_id !== opts.tenantId) {
    return { ok: false, code: "out_of_scope", message: "token is not scoped to this tenant" };
  }
  if (key.allowed_sources.length > 0 && !key.allowed_sources.includes(opts.source)) {
    return {
      ok: false,
      code: "out_of_scope",
      message: `token is not scoped to source ${opts.source}`,
    };
  }
  return { ok: true, scope: { tenantId: key.tenant_id } };
}

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

// biome-ignore-all lint/style/noExportedImports: Re-exporting an imported type from a package entry point is what makes the entry point complete. Without it a consumer imports the value from one path and its type from another.
// biome-ignore-all lint/style/useExportsLast: Reordering 28 modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. The ordering carries meaning here and the rule's preferred one does not.

// biome-ignore-all lint/correctness/noNodejsModules: This is server code running on Bun. `node:` builtins are the platform here, not a portability hazard -- the rule exists for code that must also run in a browser.

import { timingSafeEqual } from "node:crypto";
import { hashToken } from "@undercroft/crypto";
import type { SqlExecutor } from "@undercroft/db";
import { findByDigest, type IngestKeyRow, touchLastUsed } from "@undercroft/db/repos";

export type { IngestKeyRow };

/**
 * How often a key's `last_used_at` is written: once a minute per key, not once a request.
 *
 * The column exists so an admin can see whether a key is still in use, and "within the
 * last minute" answers that as well as "this second" does -- while a script posting a
 * hundred batches a minute would otherwise turn every admission into a write.
 */
export const TOUCH_INTERVAL_MS = 60_000;

/** When each key was last recorded as used, by this process. Reset only for tests. */
const touched = new Map<string, number>();

export function resetKeyUseThrottle(): void {
  touched.clear();
}

async function noteUse(exec: SqlExecutor, key: IngestKeyRow, now: Date): Promise<void> {
  const last = touched.get(key.id);
  if (last !== undefined && now.getTime() - last < TOUCH_INTERVAL_MS) {
    return;
  }
  touched.set(key.id, now.getTime());
  await touchLastUsed(exec, key.id, now);
}

export type AuthOutcome =
  | { ok: true; scope: "service" | { tenantId: string } }
  | { ok: false; code: "unauthenticated" | "out_of_scope"; message: string };

function constantTimeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.byteLength !== bb.byteLength) {
    return false;
  }
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
  await noteUse(exec, key, now);
  return { ok: true, scope: { tenantId: key.tenant_id } };
}

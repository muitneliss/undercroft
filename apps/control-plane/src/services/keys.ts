/**
 * Ingest keys: the credential a script or an orchestrator presents to land data through
 * the lake write API, managed from the Sources leaf rather than by hand in SQL.
 *
 * A key is shown ONCE, at minting, and stored as a digest. This module returns the token
 * to the one caller that asked for it and to nobody after; `list` never carries it, and an
 * admin who lost one mints another and revokes the old. The audit row records the key's id
 * and label, never the token.
 *
 * The token carries the key's id as a prefix -- `uk_a1b2c3d4.<secret>` -- so a token seen in
 * a script or a log can be matched to the row it belongs to by eye. The id is not part of
 * the credential: the worker looks a key up by the digest of the WHOLE token, and a
 * presented id proves nothing on its own.
 */

// biome-ignore-all lint/style/noExportedImports: Re-exporting an imported type from a package entry point is what makes the entry point complete. Without it a consumer imports the value from one path and its type from another.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useExportsLast: Reordering modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. That ordering carries meaning; the rule's preferred one does not.

import { hashToken, randomToken } from "@undercroft/crypto";
import type { SqlExecutor } from "@undercroft/db";
import { type IngestKey, insertKey, listKeys, revokeKey } from "@undercroft/db/repos";

import { record as recordAudit } from "../repos/auditLog.ts";

export type { IngestKey };

const ID_PREFIX = "uk_";
/** Eight base64url characters: enough to be unique across one platform, short enough to read out. */
const ID_CHARS = 8;
const DAY_MS = 86_400_000;

export function list(exec: SqlExecutor, tenantId: string): Promise<IngestKey[]> {
  return listKeys(exec, tenantId);
}

/**
 * Mint a key and hand its token back, once.
 *
 * `expiresInDays` absent means a key that does not expire, recorded as such: the alerts
 * warn a week before an expiry, and a key with none is never warned about.
 */
export async function mint(
  exec: SqlExecutor,
  input: {
    tenantId: string;
    label: string;
    allowedSources: string[];
    expiresInDays?: number;
    actor: string;
    now?: Date;
  },
): Promise<{ id: string; token: string; expiresAt: string | null }> {
  const id = `${ID_PREFIX}${randomToken().slice(0, ID_CHARS)}`;
  const token = `${id}.${randomToken()}`;
  const now = input.now ?? new Date();
  const expiresAt =
    input.expiresInDays === undefined
      ? null
      : new Date(now.getTime() + input.expiresInDays * DAY_MS).toISOString();

  await insertKey(exec, {
    id,
    tokenDigest: hashToken(token),
    tenantId: input.tenantId,
    label: input.label,
    allowedSources: input.allowedSources,
    expiresAt,
  });

  try {
    await recordAudit(exec, {
      tenantId: input.tenantId,
      actor: input.actor,
      action: "keys.mint",
      detail: JSON.stringify({
        id,
        label: input.label,
        allowedSources: input.allowedSources,
        expiresAt,
      }),
    });
  } catch {
    // Swallowed like every other audit write here: a failed insert must not lose a key
    // whose token has already been handed out.
  }

  return { id, token, expiresAt };
}

/** Revoke a live key. `false` when there was none to revoke. */
export async function revoke(
  exec: SqlExecutor,
  input: { tenantId: string; id: string; actor: string },
): Promise<boolean> {
  const revoked = await revokeKey(exec, input.tenantId, input.id);
  if (!revoked) {
    return false;
  }
  try {
    await recordAudit(exec, {
      tenantId: input.tenantId,
      actor: input.actor,
      action: "keys.revoke",
      detail: JSON.stringify({ id: input.id }),
    });
  } catch {
    // As above.
  }
  return true;
}

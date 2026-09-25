/**
 * Personal access tokens: a person's own credential for a door that cannot hold a cookie --
 * a model-context client at `/mcp` (ADR 0060).
 *
 * The pattern is `keys.ts`'s, deliberately: a token is `upat_<8>.<secret>`, stored as the
 * digest of the whole string, returned by `mint` once and by nothing else, and an audit row
 * records its id and label, never the token. The id prefix lets a person match a token in a
 * config file to its row by eye; the lookup is by digest, so a presented id proves nothing.
 *
 * What differs from an ingest key is WHOSE it is. An ingest key is a tenant's standing grant to
 * land data; this is a person's, and reaches exactly what they reach -- in every tenant they
 * belong to, through the same role gates, never more. So it is keyed by the `app_user`, not by
 * a tenant, and its audit rows carry no tenant: attributing it to one would record something
 * that is not true, the reason `repos/auditLog.ts` allows a null.
 *
 * And it carries a GRANT the person chose: `read` or `write`. What each admits is
 * `grantAdmits` in `handlers/surface.ts`; this module only records the choice and reports it
 * when the token is presented.
 */

import { hashToken, randomToken } from "@undercroft/crypto";
import type { SqlExecutor } from "@undercroft/db";
import {
  findTokenByDigest,
  type Grant,
  insertToken,
  listTokens,
  type PersonalToken,
  revokeToken,
  touchTokenUse,
} from "../repos/accessToken.ts";
import { record as recordAudit } from "../repos/auditLog.ts";

export type { Grant, PersonalToken } from "../repos/accessToken.ts";

const ID_PREFIX = "upat_";
/** Eight base64url characters: enough to be unique across one platform, short enough to read out. */
const ID_CHARS = 8;

/**
 * The longest a token may live. The table's CHECK holds the same ceiling, because the form is
 * one caller and the table is the rule; this is what the router's input refuses first.
 */
export const MAX_TOKEN_DAYS = 365;

/**
 * Whether a presented bearer is shaped like one of these tokens at all.
 *
 * The door that reads bearers asks this before admitting, because a bearer that is not ours --
 * an OAuth access token (ADR 0061) -- is the authorization server's to verify, and digesting it
 * and looking it up here would be a query that can only miss.
 */
export function isPersonalToken(bearer: string): boolean {
  return bearer.startsWith(ID_PREFIX);
}

export function list(exec: SqlExecutor, userId: string): Promise<PersonalToken[]> {
  return listTokens(exec, userId);
}

/** Mint a token and hand it back, once. `expiresInDays` is 1 to `MAX_TOKEN_DAYS`. */
export async function mint(
  exec: SqlExecutor,
  input: {
    userId: string;
    /** The owner's address, for the audit row. */
    actor: string;
    label: string;
    grant: Grant;
    expiresInDays: number;
  },
): Promise<{ id: string; token: string; grant: Grant; expiresAt: string }> {
  const id = `${ID_PREFIX}${randomToken().slice(0, ID_CHARS)}`;
  const token = `${id}.${randomToken()}`;

  const { expiresAt } = await insertToken(exec, {
    id,
    tokenDigest: hashToken(token),
    userId: input.userId,
    label: input.label,
    grant: input.grant,
    expiresInDays: input.expiresInDays,
  });

  try {
    await recordAudit(exec, {
      tenantId: null,
      actor: input.actor,
      action: "account.tokens.mint",
      detail: JSON.stringify({ id, label: input.label, grant: input.grant, expiresAt }),
    });
  } catch {
    // Swallowed like every other audit write here: a failed insert must not lose a token
    // whose secret is about to be handed out.
  }

  return { id, token, grant: input.grant, expiresAt };
}

/** Revoke one of this person's live tokens. `false` when there was none to revoke. */
export async function revoke(
  exec: SqlExecutor,
  input: { userId: string; id: string; actor: string },
): Promise<boolean> {
  const revoked = await revokeToken(exec, input.userId, input.id);
  if (!revoked) {
    return false;
  }
  try {
    await recordAudit(exec, {
      tenantId: null,
      actor: input.actor,
      action: "account.tokens.revoke",
      detail: JSON.stringify({ id: input.id }),
    });
  } catch {
    // As above.
  }
  return true;
}

/** Who a live token speaks for, and what it may do. */
export interface Admitted {
  readonly id: string;
  readonly email: string;
  readonly grant: Grant;
}

/**
 * The owner and grant of a presented token, or `null` when it admits nobody: unknown, revoked,
 * or expired. One answer for all three, because the door that asked answers all three with the
 * same 401, and a caller holding a dead token is owed no account of how it died.
 *
 * What `null` does NOT cover is whether the owner is still anybody here. That is the door's
 * shared tail (`appUserForEmail`, in `handlers/context.ts`), which every credential passes
 * through, so a token cannot outlive its owner's access by a request.
 */
export async function admit(
  exec: SqlExecutor,
  bearer: string,
  now: Date = new Date(),
): Promise<Admitted | null> {
  if (!isPersonalToken(bearer)) {
    return null;
  }
  const token = await findTokenByDigest(exec, hashToken(bearer));
  if (token === null || token.revokedAt !== null) {
    return null;
  }
  if (token.expiresAt.getTime() <= now.getTime()) {
    return null;
  }
  await touchTokenUse(exec, token.id);
  return { id: token.id, email: token.email, grant: token.grant };
}

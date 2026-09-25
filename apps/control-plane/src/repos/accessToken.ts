/**
 * `app.access_token`: a person's personal access tokens. `300_mcp_access.sql` says why they
 * exist and what the columns promise.
 *
 * Read by DIGEST, never by id, for the reason `@undercroft/db`'s `ingestKeys.ts` gives: the
 * sha-256 of the whole token is the credential, and a presented id proves nothing on its own.
 * Whether a found row may be used -- revoked, expired -- comes back as stored, and is decided
 * in `services/accessTokens.ts`; this module answers with rows.
 *
 * The one guard written here is the use throttle, because it is about concurrency rather than
 * policy: the UPDATE's own WHERE clause is what keeps two requests, or two processes, from both
 * writing `last_used_at` within the same minute.
 */

import type { SqlExecutor } from "@undercroft/db";

/** What a token was minted to do. Stored as `scope`, the one name nothing above here knows. */
export type Grant = "read" | "write";

/** What admission needs about a token: who owns it, what it may do, whether it still holds. */
export interface TokenForAdmission {
  readonly id: string;
  /** The owner's address, joined from `app.app_user`: the one fact every door resolves from. */
  readonly email: string;
  readonly grant: Grant;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

/** A token as its owner's account page lists it. Never the digest, never the token. */
export interface PersonalToken {
  readonly id: string;
  readonly label: string;
  readonly grant: Grant;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  readonly lastUsedAt: string | null;
}

function iso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function grantOf(scope: string): Grant {
  // The column's CHECK admits these two and nothing else; anything but `write` reads as the
  // narrower grant rather than the wider, should that ever stop being true.
  return scope === "write" ? "write" : "read";
}

/** The token with this digest and its owner's address, or `null` when there is none. */
export async function findTokenByDigest(
  exec: SqlExecutor,
  digest: string,
): Promise<TokenForAdmission | null> {
  const { rows } = await exec.query<{
    id: string;
    email: string;
    scope: string;
    expires_at: Date | string;
    revoked_at: Date | string | null;
  }>(
    `SELECT t.id, u.email, t.scope, t.expires_at, t.revoked_at
     FROM app.access_token t JOIN app.app_user u ON u.id = t.user_id
     WHERE t.token_sha256 = $1`,
    [digest],
  );
  const [row] = rows;
  if (row === undefined) {
    return null;
  }
  return {
    id: row.id,
    email: row.email,
    grant: grantOf(row.scope),
    expiresAt: new Date(row.expires_at),
    revokedAt: row.revoked_at === null ? null : new Date(row.revoked_at),
  };
}

/**
 * Note that a token was used, unless it already was within the last minute.
 *
 * The throttle is the WHERE clause, so it holds across concurrent requests and processes. The
 * column answers "is this token still in use", and "within the last minute" answers that as well
 * as "this second" does, without turning every call an agent makes into a write.
 */
export async function touchTokenUse(exec: SqlExecutor, id: string): Promise<void> {
  await exec.query(
    `UPDATE app.access_token SET last_used_at = now()
     WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`,
    [id],
  );
}

export async function listTokens(exec: SqlExecutor, userId: string): Promise<PersonalToken[]> {
  const { rows } = await exec.query<{
    id: string;
    label: string;
    scope: string;
    created_at: Date | string;
    expires_at: Date | string;
    revoked_at: Date | string | null;
    last_used_at: Date | string | null;
  }>(
    `SELECT id, label, scope, created_at, expires_at, revoked_at, last_used_at
     FROM app.access_token WHERE user_id = $1 ORDER BY created_at DESC, id`,
    [userId],
  );
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    grant: grantOf(row.scope),
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
    revokedAt: iso(row.revoked_at),
    lastUsedAt: iso(row.last_used_at),
  }));
}

/**
 * Store a freshly minted token -- its digest, never the token -- and answer when it expires.
 *
 * The expiry is computed here, from the database's clock, so the table's one-year CHECK and the
 * value it checks are read off the same clock.
 */
export async function insertToken(
  exec: SqlExecutor,
  input: {
    id: string;
    tokenDigest: string;
    userId: string;
    label: string;
    grant: Grant;
    expiresInDays: number;
  },
): Promise<{ expiresAt: string }> {
  const { rows } = await exec.query<{ expires_at: Date | string }>(
    `INSERT INTO app.access_token (id, token_sha256, user_id, label, scope, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6::int))
     RETURNING expires_at`,
    [input.id, input.tokenDigest, input.userId, input.label, input.grant, input.expiresInDays],
  );
  const [row] = rows;
  if (row === undefined) {
    throw new Error("insert into app.access_token returned no row");
  }
  return { expiresAt: new Date(row.expires_at).toISOString() };
}

/**
 * Revoke a live token of this person. `false` when there was none to revoke -- another
 * person's id, an unknown one, or one already revoked -- so a caller cannot learn which.
 */
export async function revokeToken(exec: SqlExecutor, userId: string, id: string): Promise<boolean> {
  const { rows } = await exec.query<{ id: string }>(
    `UPDATE app.access_token SET revoked_at = now()
     WHERE user_id = $1 AND id = $2 AND revoked_at IS NULL
     RETURNING id`,
    [userId, id],
  );
  return rows.length > 0;
}

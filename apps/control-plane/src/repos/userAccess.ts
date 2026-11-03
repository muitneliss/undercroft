/**
 * A person's access to the platform as a whole (ADR 0152): who is on it, whether each may act,
 * and the switch that takes that away and gives it back. Named for the question rather than for
 * one table, because deactivating a person is one statement over two: `app.app_user`, whose
 * `deactivated_at` is the state, and `app.access_token`, whose live tokens it revokes.
 *
 * Both transitions are conditional UPDATEs, as `repos/tenant.ts`'s are for a customer: the state
 * is the statement's condition, not a read before it, so two superadmins pressing Deactivate at
 * once produce one transition and one `null`, and the first moment is the one kept.
 *
 * Better Auth's own credentials -- sessions, an OAuth app's refresh tokens and consents -- are
 * not here. Those tables are the library's, written through its adapter wherever it keeps them
 * (`handlers/signIns.ts`); a `DELETE` of ours against them would be a second writer of a table
 * whose shape a plugin upgrade may change.
 */

import type { SqlExecutor } from "@undercroft/db";

/** One person on the platform, as a superadmin reads the list. */
export interface PlatformUser {
  readonly userId: string;
  readonly email: string;
  /** When they were first provisioned, as an ISO instant. */
  readonly createdAt: string;
  /** How many customers they are a member of: kept through a deactivation, so it still counts. */
  readonly memberships: number;
  /** When a superadmin deactivated them, as an ISO instant; `null` while they may act. */
  readonly deactivatedAt: string | null;
}

/** `pg` answers a timestamptz as a Date, PGlite as either. */
function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

/** Every person on the platform, by address. */
export async function listUsers(exec: SqlExecutor): Promise<PlatformUser[]> {
  const { rows } = await exec.query<{
    id: string;
    email: string;
    created_at: Date | string;
    memberships: number;
    deactivated_at: Date | string | null;
  }>(
    `SELECT u.id, u.email, u.created_at, u.deactivated_at,
            (SELECT count(*)::int FROM app.tenant_member m WHERE m.user_id = u.id) AS memberships
     FROM app.app_user u ORDER BY u.email`,
  );
  return rows.map((row) => ({
    userId: row.id,
    email: row.email,
    createdAt: iso(row.created_at),
    memberships: row.memberships,
    deactivatedAt: row.deactivated_at === null ? null : iso(row.deactivated_at),
  }));
}

/** What a deactivation changed in our own tables. */
export interface Deactivated {
  readonly userId: string;
  readonly deactivatedAt: string;
  /** The personal access tokens that were live and are now revoked. */
  readonly tokensRevoked: number;
}

/**
 * Deactivate a person in use, and revoke every live personal access token they hold, in one
 * statement -- so no moment exists in which they are deactivated and a token of theirs is still
 * live, or the reverse. `null` when no person in use has that address: absent, or deactivated
 * already.
 *
 * A token already revoked keeps the moment it was revoked: the person who revoked it, and when,
 * are part of its history, and overwriting them would rewrite it.
 */
export async function deactivateUser(
  exec: SqlExecutor,
  email: string,
): Promise<Deactivated | null> {
  const { rows } = await exec.query<{
    id: string;
    deactivated_at: Date | string;
    tokens: number;
  }>(
    `WITH person AS (
       UPDATE app.app_user SET deactivated_at = now()
       WHERE email = $1 AND deactivated_at IS NULL
       RETURNING id, deactivated_at
     ),
     tokens AS (
       UPDATE app.access_token t SET revoked_at = now()
       FROM person WHERE t.user_id = person.id AND t.revoked_at IS NULL
       RETURNING t.id
     )
     SELECT person.id, person.deactivated_at, (SELECT count(*)::int FROM tokens) AS tokens
     FROM person`,
    [email],
  );
  const [row] = rows;
  return row === undefined
    ? null
    : { userId: row.id, deactivatedAt: iso(row.deactivated_at), tokensRevoked: row.tokens };
}

/** What a reactivation changed, and how long the person had been deactivated. */
export interface Reactivated {
  readonly userId: string;
  readonly deactivatedSince: string;
}

/**
 * Reactivate a deactivated person. `null` when no deactivated person has that address. Their
 * memberships were never touched, so they hold again exactly what they held; the tokens the
 * deactivation revoked stay revoked.
 */
export async function reactivateUser(
  exec: SqlExecutor,
  email: string,
): Promise<Reactivated | null> {
  const { rows } = await exec.query<{ id: string; deactivated_since: Date | string }>(
    `UPDATE app.app_user u SET deactivated_at = NULL
     FROM (SELECT id, deactivated_at FROM app.app_user
           WHERE email = $1 AND deactivated_at IS NOT NULL FOR UPDATE) before
     WHERE u.id = before.id
     RETURNING u.id, before.deactivated_at AS deactivated_since`,
    [email],
  );
  const [row] = rows;
  return row === undefined
    ? null
    : { userId: row.id, deactivatedSince: iso(row.deactivated_since) };
}

/**
 * `app.invitation`: who has been asked in, and whether the offer is still open.
 *
 * Two reads and four writes, all scoped by `tenant_id` where a tenant is known -- an admin
 * of one tenant must not be able to touch another's invitation by guessing a uuid, and that
 * is enforced in the WHERE clause rather than trusted to the caller.
 *
 * `status` is derived in SQL (`listByTenant`), not assembled from two nullable columns by a
 * client: "expired" must agree with the clock the sign-in gate reads, and two clocks
 * disagree the moment one of them is a browser.
 *
 * `token_sha256` is written but never read back. `app.invitation` keeps the column for a
 * link-based flow this product does not use; a digest of a random value is stored so the
 * column keeps its shape and nothing replayable exists. The service supplies the digest.
 */

import type { SqlExecutor } from "@undercroft/db";

export interface InvitationRow {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly status: string;
  readonly expiresAt: string;
}

export interface LiveInvitation {
  readonly id: string;
  readonly tenantId: string;
  readonly role: string;
}

/** Every invitation for a tenant, newest first, with its status resolved in SQL. */
export async function listByTenant(exec: SqlExecutor, tenantId: string): Promise<InvitationRow[]> {
  const { rows } = await exec.query<{
    id: string;
    email: string;
    role: string;
    status: string;
    expires_at: string;
  }>(
    `SELECT id, email, role, expires_at,
            CASE WHEN accepted_at IS NOT NULL THEN 'accepted'
                 WHEN expires_at <= now()     THEN 'expired'
                 ELSE 'pending' END AS status
     FROM app.invitation WHERE tenant_id = $1
     ORDER BY created_at DESC`,
    [tenantId],
  );
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    status: r.status,
    expiresAt: r.expires_at,
  }));
}

/**
 * Every open, unexpired invitation for an address, across tenants.
 *
 * All of them, not the first: an operator may be invited to several tenants before ever
 * signing in, and honouring one while silently leaving the rest pending is the kind of
 * half-state nobody goes looking for.
 */
export async function listLiveForEmail(
  exec: SqlExecutor,
  email: string,
): Promise<LiveInvitation[]> {
  const { rows } = await exec.query<{ id: string; tenant_id: string; role: string }>(
    `SELECT id, tenant_id, role FROM app.invitation
     WHERE email = $1 AND accepted_at IS NULL AND expires_at > now()`,
    [email],
  );
  return rows.map((r) => ({ id: r.id, tenantId: r.tenant_id, role: r.role }));
}

/** Whether an address is known here or holds a live invitation. One statement, one round trip. */
export async function isKnownOrInvited(exec: SqlExecutor, email: string): Promise<boolean> {
  const { rows } = await exec.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM app.app_user WHERE email = $1
       UNION ALL
       SELECT 1 FROM app.invitation
       WHERE email = $1 AND accepted_at IS NULL AND expires_at > now()
     ) AS ok`,
    [email],
  );
  return rows[0]?.ok === true;
}

/** Open an invitation. `days` is interpolated as a parameter, never as SQL. */
export async function create(
  exec: SqlExecutor,
  input: {
    tenantId: string;
    email: string;
    role: string;
    tokenDigest: string;
    days: number;
  },
): Promise<string | null> {
  const { rows } = await exec.query<{ id: string }>(
    `INSERT INTO app.invitation (tenant_id, email, role, token_sha256, expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' days')::interval)
     RETURNING id`,
    [input.tenantId, input.email, input.role, input.tokenDigest, String(input.days)],
  );
  return rows[0]?.id ?? null;
}

/**
 * Drop any other open invitation for the same address in this tenant, so exactly one is live.
 *
 * Accepted invitations are left alone: a redeemed invitation is history, and deleting it
 * would rewrite the record of how someone got access.
 */
export async function supersedeOthers(
  exec: SqlExecutor,
  tenantId: string,
  email: string,
  keepId: string,
): Promise<void> {
  await exec.query(
    `DELETE FROM app.invitation
     WHERE tenant_id = $1 AND email = $2 AND accepted_at IS NULL AND id <> $3`,
    [tenantId, email, keepId],
  );
}

/**
 * Withdraw an unaccepted invitation. `true` if one was open to withdraw.
 *
 * Scoped by `tenant_id` as well as `id`, and by `accepted_at IS NULL`: removing the access
 * of someone who already accepted is removing their membership, not their invitation, and
 * conflating the two would look like it worked and change nothing.
 */
export async function deleteOpen(
  exec: SqlExecutor,
  id: string,
  tenantId: string,
): Promise<boolean> {
  const { rows } = await exec.query<{ id: string }>(
    `DELETE FROM app.invitation
     WHERE id = $1 AND tenant_id = $2 AND accepted_at IS NULL
     RETURNING id`,
    [id, tenantId],
  );
  return rows[0] !== undefined;
}

/** Record that an invitation has been redeemed. */
export async function markAccepted(exec: SqlExecutor, id: string): Promise<void> {
  await exec.query("UPDATE app.invitation SET accepted_at = now() WHERE id = $1", [id]);
}

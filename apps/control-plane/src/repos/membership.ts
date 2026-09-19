/**
 * `app.tenant_member`: who may see a tenant, and with what authority.
 *
 * Every tenant-scoped request passes through `roleFor`, which makes this the narrowest and
 * most load-bearing repo in the control plane. Two things it deliberately does NOT do:
 *
 * - it does not decide what a missing row means. `null` comes back, and
 *   `handlers/trpc.ts` turns that into NOT_FOUND rather than FORBIDDEN, because a 403
 *   confirms the tenant exists and turns any tenant endpoint into an enumeration oracle.
 *   The reasoning lives with the decision, one layer up;
 * - it does not rank roles. `ROLE_RANK` is authority, not storage.
 *
 * `listForUser` joins `ops.tenant` because the caller wants tenants they are a member of --
 * the membership is the filter, so the query belongs on this side of the join.
 */

import type { Locale } from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";

export type Role = "viewer" | "member" | "admin";

export interface MemberTenant {
  readonly id: string;
  readonly displayName: string;
  readonly role: string;
}

export interface Member {
  readonly userId: string;
  readonly email: string;
  readonly role: string;
}

/** The caller's role in one tenant, or `null` when they are not a member of it. */
export async function roleFor(
  exec: SqlExecutor,
  tenantId: string,
  userId: string,
): Promise<Role | null> {
  const { rows } = await exec.query<{ role: Role }>(
    "SELECT role FROM app.tenant_member WHERE tenant_id = $1 AND user_id = $2",
    [tenantId, userId],
  );
  return rows[0]?.role ?? null;
}

/**
 * The tenants one user is a member of.
 *
 * This query IS the visibility boundary for the list view: a tenant absent from the result
 * is a tenant the caller is never told about.
 */
export async function listForUser(exec: SqlExecutor, userId: string): Promise<MemberTenant[]> {
  const { rows } = await exec.query<{ id: string; display_name: string; role: string }>(
    `SELECT t.id, t.display_name, m.role
     FROM app.tenant_member m JOIN ops.tenant t ON t.id = m.tenant_id
     WHERE m.user_id = $1 ORDER BY t.id`,
    [userId],
  );
  return rows.map((r) => ({ id: r.id, displayName: r.display_name, role: r.role }));
}

/** Someone an alert about a tenant goes to, in the language they read. */
export interface Recipient {
  readonly email: string;
  readonly locale: Locale;
}

/**
 * The tenant's administrators, with the language each has chosen.
 *
 * Admins only: an alert says "reconnect this source" or "the run failed", and those are an
 * admin's to act on. A viewer told the same thing can do nothing but worry.
 */
export async function listAdmins(exec: SqlExecutor, tenantId: string): Promise<Recipient[]> {
  const { rows } = await exec.query<{ email: string; locale: Locale }>(
    `SELECT u.email, u.locale
     FROM app.tenant_member m JOIN app.app_user u ON u.id = m.user_id
     WHERE m.tenant_id = $1 AND m.role = 'admin' ORDER BY u.email`,
    [tenantId],
  );
  return rows;
}

/** Everyone with access to one tenant, by address. */
export async function listMembers(exec: SqlExecutor, tenantId: string): Promise<Member[]> {
  const { rows } = await exec.query<{ user_id: string; email: string; role: string }>(
    `SELECT m.user_id, u.email, m.role
     FROM app.tenant_member m JOIN app.app_user u ON u.id = m.user_id
     WHERE m.tenant_id = $1 ORDER BY u.email`,
    [tenantId],
  );
  return rows.map((r) => ({ userId: r.user_id, email: r.email, role: r.role }));
}

/**
 * The role held by an address in one tenant, or `null`.
 *
 * By address rather than by user id, because the question is asked about someone who may
 * not have signed in yet -- an invitation names an address, and an address that already has
 * access must not be invited again.
 */
export async function roleForEmail(
  exec: SqlExecutor,
  tenantId: string,
  email: string,
): Promise<string | null> {
  const { rows } = await exec.query<{ role: string }>(
    `SELECT m.role FROM app.tenant_member m JOIN app.app_user u ON u.id = m.user_id
     WHERE m.tenant_id = $1 AND u.email = $2`,
    [tenantId, email],
  );
  return rows[0]?.role ?? null;
}

/**
 * Grant access, idempotently.
 *
 * `DO NOTHING` rather than an upsert: redeeming an invitation must not quietly change the
 * role of someone who already has access, which is what an `ON CONFLICT DO UPDATE` here
 * would do to an admin who was later invited as a viewer.
 */
export async function addMember(
  exec: SqlExecutor,
  tenantId: string,
  userId: string,
  role: string,
): Promise<void> {
  await exec.query(
    `INSERT INTO app.tenant_member (tenant_id, user_id, role) VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, user_id) DO NOTHING`,
    [tenantId, userId, role],
  );
}

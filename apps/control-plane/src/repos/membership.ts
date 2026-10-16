/**
 * `app.tenant_member`: who may see a tenant, and with what authority.
 *
 * Every tenant-scoped request passes through `accessFor`, which makes this the narrowest and
 * most load-bearing repo in the control plane. Two things it deliberately does NOT do:
 *
 * - it does not decide what a missing row means. `null` comes back, and
 *   `handlers/trpc.ts` turns that into NOT_FOUND rather than FORBIDDEN, because a 403
 *   confirms the tenant exists and turns any tenant endpoint into an enumeration oracle.
 *   The reasoning lives with the decision, one layer up;
 * - it does not say what a role may do. A role here is a stored key; which permissions it
 *   holds is `BUILT_IN_GRANTS` (`@undercroft/contracts/access`), and Casbin evaluates them (`services/rbac.ts`, ADR 0139).
 *
 * The one place a role key IS a fact about storage is the last-admin guard below, written on the
 * literal `'admin'` because the check and the write must be one statement.
 *
 * `listForUser` joins `ops.tenant` because the caller wants tenants they are a member of --
 * the membership is the filter, so the query belongs on this side of the join.
 */

import type { BuiltInRole } from "@undercroft/contracts/access";
import type { Locale } from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";

import { deactivatedAtOf, type Tenant, type TenantRow, toTenant } from "./tenant.ts";

/**
 * A role a person can be given. The four built-ins in PR 1 (ADR 0139), and the CHECK on the
 * column agrees (`590_tenant_roles.sql`). What is READ back is typed `string` instead, because a
 * row is whatever the database holds and a cast to this union would be a promise nothing checked.
 */
export type Role = BuiltInRole;

/**
 * A tenant as one member sees it in their list: the tenant, deactivated or not, and their role.
 * A deactivated customer stays in its members' lists, marked, rather than vanishing -- a book
 * that disappears reads as one that was deleted (ADR 0110).
 */
export interface MemberTenant extends Tenant {
  readonly role: string;
}

/** A member's standing in one tenant: their role key, and whether the tenant is deactivated. */
export interface MemberAccess {
  readonly role: string;
  readonly deactivatedAt: string | null;
}

export interface Member {
  readonly userId: string;
  readonly email: string;
  readonly role: string;
}

/**
 * The caller's role in one tenant and that tenant's state, or `null` when they are not a member.
 *
 * One statement rather than a membership read and then a tenant read, because it runs on every
 * tenant-scoped request and the membership is the filter either way: a non-member learns
 * nothing about the tenant's state, because there is no row to carry it.
 *
 * It stays one statement as access grows (ADR 0139): a customer's own roles (PR 2) are a LEFT
 * JOIN from `m.role` onto the permissions that role holds, here, rather than a second query per
 * request. What it answers is the input Casbin's projection needs, and nothing it decides.
 */
export async function accessFor(
  exec: SqlExecutor,
  tenantId: string,
  userId: string,
): Promise<MemberAccess | null> {
  const { rows } = await exec.query<{ role: string } & Pick<TenantRow, "deactivated_at">>(
    `SELECT m.role, t.deactivated_at
     FROM app.tenant_member m JOIN ops.tenant t ON t.id = m.tenant_id
     WHERE m.tenant_id = $1 AND m.user_id = $2`,
    [tenantId, userId],
  );
  const [row] = rows;
  if (row === undefined) {
    return null;
  }
  return { role: row.role, deactivatedAt: deactivatedAtOf(row) };
}

/**
 * The tenants one user is a member of.
 *
 * This query IS the visibility boundary for the list view: a tenant absent from the result
 * is a tenant the caller is never told about.
 */
export async function listForUser(exec: SqlExecutor, userId: string): Promise<MemberTenant[]> {
  const { rows } = await exec.query<TenantRow & { role: string }>(
    `SELECT t.id, t.display_name, t.deactivated_at, m.role
     FROM app.tenant_member m JOIN ops.tenant t ON t.id = m.tenant_id
     WHERE m.user_id = $1 ORDER BY t.id`,
    [userId],
  );
  return rows.map((r) => ({ ...toTenant(r), role: r.role }));
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
 * What a change to one membership found and did.
 *
 * `held` is the role the address held before, or `null` when it holds none here; `done` is
 * whether the row was changed. `held` set and `done` false means the statement's own guard
 * refused -- the change would have left the tenant with no admin.
 */
export interface MembershipChange {
  readonly held: Role | null;
  readonly done: boolean;
}

/*
 * The last-admin guard is written into the statement rather than read first and checked in
 * the service, because the check and the write must be one step. Two admins demoting each
 * other at the same moment each see the other still in place, and a read-then-write lets
 * both through; the customer is then locked out with every row looking legitimate.
 *
 * `admins` locks every admin row of the tenant `FOR UPDATE` before the guard counts them.
 * The second of two concurrent statements waits on that lock, and when it proceeds Postgres
 * re-reads each locked row, drops the one the first statement just demoted or deleted, and
 * counts what is really left. `MATERIALIZED` keeps it a single locking scan rather than
 * letting the planner fold it into the guard. It is only evaluated when the change could
 * cost the tenant an admin -- the `OR` settles every other case before reaching it.
 */
const TARGET_AND_ADMINS = `
  admins AS MATERIALIZED (
    SELECT user_id FROM app.tenant_member
    WHERE tenant_id = $1 AND role = 'admin'
    FOR UPDATE
  ),
  target AS (
    SELECT m.user_id, m.role FROM app.tenant_member m
    JOIN app.app_user u ON u.id = m.user_id
    WHERE m.tenant_id = $1 AND u.email = $2
  )`;

const ANOTHER_ADMIN_REMAINS = "EXISTS (SELECT 1 FROM admins a WHERE a.user_id <> t.user_id)";

/** Change the role an address holds in one tenant, unless that removes the last admin. */
export async function changeRole(
  exec: SqlExecutor,
  tenantId: string,
  email: string,
  role: Role,
): Promise<MembershipChange> {
  const { rows } = await exec.query<{ held: Role; done: boolean }>(
    `WITH ${TARGET_AND_ADMINS},
     changed AS (
       UPDATE app.tenant_member m SET role = $3
       FROM target t
       WHERE m.tenant_id = $1 AND m.user_id = t.user_id
         AND ($3 = 'admin' OR t.role <> 'admin' OR ${ANOTHER_ADMIN_REMAINS})
       RETURNING m.user_id
     )
     SELECT t.role AS held, EXISTS (SELECT 1 FROM changed) AS done FROM target t`,
    [tenantId, email, role],
  );
  return { held: rows[0]?.held ?? null, done: rows[0]?.done === true };
}

/** End an address's access to one tenant, unless it is the tenant's last admin. */
export async function removeMember(
  exec: SqlExecutor,
  tenantId: string,
  email: string,
): Promise<MembershipChange> {
  const { rows } = await exec.query<{ held: Role; done: boolean }>(
    `WITH ${TARGET_AND_ADMINS},
     removed AS (
       DELETE FROM app.tenant_member m
       USING target t
       WHERE m.tenant_id = $1 AND m.user_id = t.user_id
         AND (t.role <> 'admin' OR ${ANOTHER_ADMIN_REMAINS})
       RETURNING m.user_id
     )
     SELECT t.role AS held, EXISTS (SELECT 1 FROM removed) AS done FROM target t`,
    [tenantId, email],
  );
  return { held: rows[0]?.held ?? null, done: rows[0]?.done === true };
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

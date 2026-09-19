/**
 * Which tenants a caller can see, what one of them is called, how a new one comes to be, and
 * how its name is corrected afterwards.
 *
 * `get` returns `null` for a tenant that does not exist and leaves the reporting to the
 * handler. It does not take the caller's role into account: membership has already been
 * established by `tenantProcedure` before this runs, so re-checking it here would be a
 * second authorization decision in a second place -- the way the two drift apart.
 *
 * `listForCaller` is the one place that branches on platform authority, because the two
 * cases are genuinely different questions: an ordinary caller asks "which customers am I a
 * member of", and a superadmin asks "which customers are there". Folding both into one
 * query with an `OR` would turn the visibility boundary into a condition inside a `WHERE`
 * clause rather than a choice of query, and the difference between those is how a boundary
 * gets widened by accident.
 */

import type { SqlExecutor } from "@undercroft/db";
import { record as recordAudit } from "../repos/auditLog.ts";
import { listForUser, type MemberTenant } from "../repos/membership.ts";
import {
  createTenant,
  findTenant,
  listAllTenants,
  renameTenant,
  type Tenant,
} from "../repos/tenant.ts";

export type { MemberTenant } from "../repos/membership.ts";
export type { Tenant } from "../repos/tenant.ts";

/**
 * The tenants this caller may see. Non-membership is invisible, not forbidden.
 *
 * A superadmin sees every tenant, each reported as `admin` -- which is exactly the authority
 * `authz.authorityIn` grants them when they open one, so the list and the page cannot
 * disagree about what may be done there.
 */
export async function listForCaller(
  exec: SqlExecutor,
  caller: { userId: string; superadmin: boolean },
): Promise<MemberTenant[]> {
  if (!caller.superadmin) {
    return await listForUser(exec, caller.userId);
  }

  const all = await listAllTenants(exec);
  return all.map((tenant) => ({ id: tenant.id, displayName: tenant.displayName, role: "admin" }));
}

/** One tenant, or `null`. */
export function get(exec: SqlExecutor, tenantId: string): Promise<Tenant | null> {
  return findTenant(exec, tenantId);
}

export type CreateResult =
  | { readonly ok: true; readonly tenant: Tenant }
  /** The reference is already in use. Reported, never a success that quietly changed nothing. */
  | { readonly ok: false; readonly reason: "already-exists" };

/**
 * Create a customer.
 *
 * A value, not an exception, like every other decision in this layer -- `handlers/router.ts`
 * is where `already-exists` becomes a CONFLICT. Authority is NOT re-checked here: this is
 * reachable only through `superadminProcedure`, and a second check in a second place is the
 * arrangement where one of the two is later relaxed alone.
 *
 * The audit row is written in the same call rather than by the handler, because "a customer
 * was created, and by whom" is one fact. Its `tenantId` is the new customer, so the record
 * sits with the tenant it concerns rather than in the platform-wide null bucket.
 */
export async function create(
  exec: SqlExecutor,
  input: { tenantId: string; displayName: string; actor: string },
): Promise<CreateResult> {
  const created = await createTenant(exec, input.tenantId, input.displayName);
  if (!created) {
    return { ok: false, reason: "already-exists" };
  }

  await recordAudit(exec, {
    tenantId: input.tenantId,
    actor: input.actor,
    action: "tenants.create",
    detail: JSON.stringify({ displayName: input.displayName }),
  });

  return { ok: true, tenant: { id: input.tenantId, displayName: input.displayName } };
}

/**
 * Retitle a customer.
 *
 * Only the display name moves, and the split between the two columns is the whole reason
 * this is safe to offer at all: the id reaches the raw lake as an object-key prefix and can
 * never be changed once a byte has landed under it, while the display name reaches nothing
 * but this row. An operator who mistyped a customer's name had no way to repair it before
 * this existed -- the create form was the only writer -- so the typo outlived the mistake.
 *
 * `null` for a tenant that is not there, like `get`: whether absent is a 404 is argued in
 * `handlers/router.ts`. In practice `tenantProcedure` has already established authority over
 * a tenant that exists, so this answers `null` only in a race with a deletion.
 *
 * The audit row carries both names. "Acme is now Acme Holdings" is the fact worth keeping;
 * the new name alone would leave a reader unable to tell what was repaired.
 */
export async function rename(
  exec: SqlExecutor,
  input: { tenantId: string; displayName: string; actor: string },
): Promise<Tenant | null> {
  const before = await findTenant(exec, input.tenantId);
  if (before === null) {
    return null;
  }

  const renamed = await renameTenant(exec, input.tenantId, input.displayName);
  if (renamed === null) {
    return null;
  }

  await recordAudit(exec, {
    tenantId: input.tenantId,
    actor: input.actor,
    action: "tenants.rename",
    detail: JSON.stringify({ from: before.displayName, to: renamed.displayName }),
  });

  return renamed;
}

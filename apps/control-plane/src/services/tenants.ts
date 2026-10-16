/**
 * Which tenants a caller can see, what one of them is called, how a new one comes to be, how
 * its name is corrected afterwards, and how it is deactivated and reactivated (ADR 0110).
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

import { ADMIN_ROLE, type Permission } from "@undercroft/contracts/access";
import type { SqlExecutor } from "@undercroft/db";
import { isRoleCollision, provisionTenantRoles } from "@undercroft/db/repos";
import { type Actor, record as recordAudit } from "../repos/auditLog.ts";
import { listForUser, type MemberTenant } from "../repos/membership.ts";
import {
  createTenant,
  deactivateTenant,
  findTenant,
  listAllTenants,
  reactivateTenant,
  renameTenant,
  type Tenant,
  undoCreateTenant,
} from "../repos/tenant.ts";
import { permissionsOf } from "./rbac.ts";

/** A tenant in the caller's list, with the role they hold there and what it lets them do. */
export interface ListedTenant extends MemberTenant {
  readonly permissions: readonly Permission[];
}
export type { Tenant } from "../repos/tenant.ts";

/**
 * The tenants this caller may see. Non-membership is invisible, not forbidden.
 *
 * A superadmin sees every tenant, each reported as `admin` -- which is exactly the authority
 * `authz.accessIn` grants them when they open one, so the list and the page cannot
 * disagree about what may be done there. Each row's `permissions` is asked of the same
 * evaluator for the same reason (ADR 0139): the list is how a page knows which divisions to
 * offer before it has opened any one customer.
 */
export async function listForCaller(
  exec: SqlExecutor,
  caller: { userId: string; superadmin: boolean },
): Promise<ListedTenant[]> {
  const rows: readonly MemberTenant[] = caller.superadmin
    ? (await listAllTenants(exec)).map((tenant) => ({ ...tenant, role: ADMIN_ROLE }))
    : await listForUser(exec, caller.userId);
  return await Promise.all(
    rows.map(async (row) => ({
      ...row,
      permissions: await permissionsOf({ userId: caller.userId, tenantId: row.id, role: row.role }),
    })),
  );
}

/** One tenant, or `null`. */
export function get(exec: SqlExecutor, tenantId: string): Promise<Tenant | null> {
  return findTenant(exec, tenantId);
}

export type CreateResult =
  | { readonly ok: true; readonly tenant: Tenant }
  /** The reference is already in use. Reported, never a success that quietly changed nothing. */
  | { readonly ok: false; readonly reason: "already-exists" }
  /**
   * The reference folds to the same Postgres role name as an existing customer's --
   * `CASE-0042` and `case_0042` would share a login. Refused, and the row undone.
   */
  | { readonly ok: false; readonly reason: "role-collision" };

/**
 * Create a customer, and the two database roles that are its own.
 *
 * A value, not an exception, like every other decision in this layer -- `handlers/router.ts`
 * is where `already-exists` becomes a CONFLICT. Authority is NOT re-checked here: this is
 * reachable only through `superadminProcedure`, and a second check in a second place is the
 * arrangement where one of the two is later relaxed alone.
 *
 * The roles are provisioned in the same call because a customer without them is a customer
 * whose first build and first report would fail with a login nobody can explain. When the
 * provisioning is refused -- the one refusal it has is a slug collision -- the row it
 * followed is taken back, so the operator is left with a refusal and not with a half-made
 * customer. A transaction would do the same; the explicit undo keeps this layer on the plain
 * executor every other decision uses.
 *
 * The audit row is written in the same call rather than by the handler, because "a customer
 * was created, and by whom" is one fact. Its `tenantId` is the new customer, so the record
 * sits with the tenant it concerns rather than in the platform-wide null bucket.
 */
export async function create(
  exec: SqlExecutor,
  input: { tenantId: string; displayName: string; actor: Actor },
): Promise<CreateResult> {
  const created = await createTenant(exec, input.tenantId, input.displayName);
  if (!created) {
    return { ok: false, reason: "already-exists" };
  }

  try {
    await provisionTenantRoles(exec, input.tenantId);
  } catch (error) {
    if (isRoleCollision(error)) {
      await undoCreateTenant(exec, input.tenantId);
      return { ok: false, reason: "role-collision" };
    }
    throw error;
  }

  await recordAudit(exec, {
    tenantId: input.tenantId,
    actor: input.actor,
    action: "tenants.create",
    detail: JSON.stringify({ displayName: input.displayName }),
  });

  return {
    ok: true,
    tenant: { id: input.tenantId, displayName: input.displayName, deactivatedAt: null },
  };
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
  input: { tenantId: string; displayName: string; actor: Actor },
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

export type TransitionResult =
  | { readonly ok: true; readonly tenant: Tenant }
  /**
   * The tenant is already in the state asked for. Refused rather than reported as done: a
   * second "deactivate" that answered success would overwrite nothing and record nothing, and
   * the person pressing it would believe they had just cut the customer off -- when somebody
   * else did, at a moment they are not being told.
   */
  | { readonly ok: false; readonly reason: "already-deactivated" | "already-active" }
  /** No tenant with that id. In practice only a race with a deletion; the handler words it. */
  | { readonly ok: false; readonly reason: "not-found" };

/**
 * Deactivate a customer: every member loses access and nothing more is started for it, until
 * an admin reactivates it. ADR 0110.
 *
 * Nothing is deleted. The state is one column (`ops.tenant.deactivated_at`), the transition one
 * conditional UPDATE, and the audit row the record of who did it -- written here rather than
 * by the handler, because "the customer was deactivated, and by whom" is one fact. Authority is
 * not re-checked: this is reachable through `requirePermission("tenant:manage")` alone.
 */
export async function deactivate(
  exec: SqlExecutor,
  input: { tenantId: string; actor: Actor },
): Promise<TransitionResult> {
  const changed = await deactivateTenant(exec, input.tenantId);
  if (changed === null) {
    return await refusedTransition(exec, input.tenantId);
  }
  await recordAudit(exec, {
    tenantId: input.tenantId,
    actor: input.actor,
    action: "tenants.deactivate",
    detail: JSON.stringify({ deactivatedAt: changed.deactivatedAt }),
  });
  return { ok: true, tenant: changed };
}

/**
 * Reactivate a deactivated customer: access and schedules return exactly as they were, since
 * deactivating took nothing away but the permission to use them.
 *
 * The audit row carries when the customer had been deactivated, so the pair of rows reads as
 * the whole interval without a reader having to find the first one.
 */
export async function reactivate(
  exec: SqlExecutor,
  input: { tenantId: string; actor: Actor },
): Promise<TransitionResult> {
  const before = await findTenant(exec, input.tenantId);
  const changed = await reactivateTenant(exec, input.tenantId);
  if (changed === null) {
    return await refusedTransition(exec, input.tenantId);
  }
  await recordAudit(exec, {
    tenantId: input.tenantId,
    actor: input.actor,
    action: "tenants.reactivate",
    detail: JSON.stringify({ deactivatedSince: before?.deactivatedAt ?? null }),
  });
  return { ok: true, tenant: changed };
}

/** Why a transition changed nothing, read after the conditional UPDATE declined. */
async function refusedTransition(exec: SqlExecutor, tenantId: string): Promise<TransitionResult> {
  const now = await findTenant(exec, tenantId);
  if (now === null) {
    return { ok: false, reason: "not-found" };
  }
  return {
    ok: false,
    reason: now.deactivatedAt === null ? "already-active" : "already-deactivated",
  };
}

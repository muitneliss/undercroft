/**
 * Authority: what a caller may do in a tenant.
 *
 * Deliberately thin, and deliberately not in the handler. `roleFor` answers with a role or
 * `null`; `ROLE_RANK` orders authority. Neither knows what HTTP is, so the 404-not-403
 * decision -- the security-relevant part -- stays in one place in `handlers/trpc.ts` where
 * the reasoning is recorded, instead of being spread across every procedure that needs a
 * role.
 *
 * `ROLE_RANK` is here rather than in the repo because it is policy, not storage: the
 * database stores which role someone has, and this file is where "admin outranks member"
 * is stated.
 *
 * `accessIn` is the second policy statement: a superadmin holds `admin` in every tenant
 * without a membership row. It lives here, above the repo and below the handler, so that a
 * platform administrator and an ordinary member arrive at `tenantProcedure` as the same
 * shape -- an `Access` or `null` -- and the 404-not-403 decision is still argued exactly once.
 * The alternative, a second branch in the middleware, is how an authorization check drifts
 * away from the query it was meant to guard.
 *
 * Since ADR 0110 the answer also carries whether the tenant is deactivated. Authority and state
 * are two facts and stay two fields: a deactivated tenant's admin is still its admin -- that is
 * who may reactivate it -- and the refusal a deactivated tenant earns is argued in
 * `handlers/trpc.ts`, beside the 404, from the one answer this module gives.
 */

import type { SqlExecutor } from "@undercroft/db";
import { accessFor, type Role, roleFor as roleForMember } from "../repos/membership.ts";
import { findTenant } from "../repos/tenant.ts";
import { isSuperadmin, type Superadmins } from "./superadmin.ts";

export type { Role } from "../repos/membership.ts";

/** What a caller holds in a tenant: their authority, and the tenant's state. */
export interface Access {
  readonly role: Role;
  /** When the tenant was deactivated; `null` while it is in use. ADR 0110. */
  readonly deactivatedAt: string | null;
}

export const ROLE_RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2 };

/** The caller's role in a tenant, or `null` when they are not a member. */
export function roleFor(exec: SqlExecutor, tenantId: string, userId: string): Promise<Role | null> {
  return roleForMember(exec, tenantId, userId);
}

/**
 * What authority this caller holds in this tenant, membership or platform, and the tenant's
 * state -- or `null`.
 *
 * A superadmin resolves to `admin` -- but only in a tenant that **exists**. Answering
 * `admin` for `CASE-does-not-exist` would let every tenant-scoped procedure run against a
 * customer that is not there, and the failures would surface as empty lists rather than as
 * a 404: the caller would be told, plausibly and wrongly, that the customer has no
 * connections and no people. So the existence check is not a courtesy, it is what keeps
 * `null` meaning the same thing on both paths.
 *
 * Note which question is *not* asked of a superadmin: whether they are a member. That is
 * the whole point of the role, and it is why withdrawing it is an environment change rather
 * than a `DELETE`. `services/superadmin.ts` records the trade-off.
 */
export async function accessIn(
  exec: SqlExecutor,
  input: { tenantId: string; userId: string; superadmin: boolean },
): Promise<Access | null> {
  if (!input.superadmin) {
    return await accessFor(exec, input.tenantId, input.userId);
  }
  const tenant = await findTenant(exec, input.tenantId);
  if (tenant === null) {
    return null;
  }
  return { role: "admin", deactivatedAt: tenant.deactivatedAt };
}

/**
 * Where a caller stands as an admin of a tenant, for a door with no middleware to ask.
 *
 * Three answers rather than a boolean, because the OAuth callback has to say WHICH refusal it
 * is: an admin of a deactivated customer is not a non-admin, and reporting one as the other
 * would send a person to ask for a role they already hold. The tenant's state is asked only of
 * an admin -- a caller without the authority learns `not-admin` and nothing else.
 */
export type AdminStanding = "admin" | "not-admin" | "deactivated";

/**
 * May this caller act as an admin of this tenant now? Membership or platform, one answer --
 * and `deactivated` for an admin of a customer that is deactivated (ADR 0110).
 *
 * The whole question in one call, because the caller that needs it most is outside tRPC.
 * `tenantProcedure` reaches `accessIn` through the middleware and cannot get this wrong;
 * the OAuth callback has no middleware, and the first cut of it asked `roleFor` instead --
 * a membership lookup, which a superadmin deliberately has no row in. The effect was a
 * consent that a platform administrator could start, that Google would grant, and that the
 * final step then refused as `not-admin`, every time.
 *
 * So the composition lives here beside `accessIn` rather than at the wiring, where each
 * call site gets to decide again whether platform authority counts. It takes the address
 * because that, not the uuid, is what `UNDERCROFT_SUPERADMINS` names.
 */
export async function adminStandingIn(
  exec: SqlExecutor,
  superadmins: Superadmins,
  caller: { tenantId: string; userId: string; email: string },
): Promise<AdminStanding> {
  const access = await accessIn(exec, {
    tenantId: caller.tenantId,
    userId: caller.userId,
    superadmin: isSuperadmin(superadmins, caller.email),
  });
  if (access?.role !== "admin") {
    return "not-admin";
  }
  return access.deactivatedAt === null ? "admin" : "deactivated";
}

/** Whether `held` carries at least the authority of `min`. */
export function outranks(held: Role, min: Role): boolean {
  return ROLE_RANK[held] >= ROLE_RANK[min];
}

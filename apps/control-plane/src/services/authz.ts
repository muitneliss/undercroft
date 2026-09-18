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
 * `authorityIn` is the second policy statement: a superadmin holds `admin` in every tenant
 * without a membership row. It lives here, above the repo and below the handler, so that a
 * platform administrator and an ordinary member arrive at `tenantProcedure` as the same
 * shape -- a `Role` or `null` -- and the 404-not-403 decision is still argued exactly once.
 * The alternative, a second branch in the middleware, is how an authorization check drifts
 * away from the query it was meant to guard.
 */

// biome-ignore-all lint/style/noExportedImports: Re-exporting an imported type from a package entry point is what makes the entry point complete. Without it a consumer imports the value from one path and its type from another.

import type { SqlExecutor } from "@undercroft/db";
import { type Role, roleFor as roleForMember } from "../repos/membership.ts";
import { findTenant } from "../repos/tenant.ts";
import { isSuperadmin, type Superadmins } from "./superadmin.ts";

export type { Role };

export const ROLE_RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2 };

/** The caller's role in a tenant, or `null` when they are not a member. */
export function roleFor(exec: SqlExecutor, tenantId: string, userId: string): Promise<Role | null> {
  return roleForMember(exec, tenantId, userId);
}

/**
 * What authority this caller holds in this tenant, membership or platform, or `null`.
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
export async function authorityIn(
  exec: SqlExecutor,
  input: { tenantId: string; userId: string; superadmin: boolean },
): Promise<Role | null> {
  if (!input.superadmin) {
    return await roleForMember(exec, input.tenantId, input.userId);
  }
  if ((await findTenant(exec, input.tenantId)) === null) {
    return null;
  }
  return "admin";
}

/**
 * May this caller act as an admin of this tenant? Membership or platform, one answer.
 *
 * The whole question in one call, because the caller that needs it most is outside tRPC.
 * `tenantProcedure` reaches `authorityIn` through the middleware and cannot get this wrong;
 * the OAuth callback has no middleware, and the first cut of it asked `roleFor` instead --
 * a membership lookup, which a superadmin deliberately has no row in. The effect was a
 * consent that a platform administrator could start, that Google would grant, and that the
 * final step then refused as `not-admin`, every time.
 *
 * So the composition lives here beside `authorityIn` rather than at the wiring, where each
 * call site gets to decide again whether platform authority counts. It takes the address
 * because that, not the uuid, is what `UNDERCROFT_SUPERADMINS` names.
 */
export async function isAdminIn(
  exec: SqlExecutor,
  superadmins: Superadmins,
  caller: { tenantId: string; userId: string; email: string },
): Promise<boolean> {
  const role = await authorityIn(exec, {
    tenantId: caller.tenantId,
    userId: caller.userId,
    superadmin: isSuperadmin(superadmins, caller.email),
  });
  return role === "admin";
}

/** Whether `held` carries at least the authority of `min`. */
export function outranks(held: Role, min: Role): boolean {
  return ROLE_RANK[held] >= ROLE_RANK[min];
}

/**
 * Authority: what a caller may do in a tenant.
 *
 * Deliberately not in the handler. `accessIn` answers with an `Access` or `null` and knows
 * nothing about HTTP, so the 404-not-403 decision -- the security-relevant part -- stays in one
 * place in `handlers/trpc.ts` where the reasoning is recorded, instead of being spread across
 * every procedure that needs a permission.
 *
 * Since ADR 0139 an `Access` carries the caller's PERMISSIONS, which Casbin evaluated over policy
 * projected from the membership row and the built-in grants (`rbac.ts`, `BUILT_IN_GRANTS`). A
 * procedure asks for a permission, never a role: "may this person save a model" is
 * `models:write`, which a builder and an admin hold, and no ordering of roles could say that
 * without also saying a builder may invite people. The role key travels beside the permissions
 * because a person reads it ("you are a builder"), not because anything decides on it.
 *
 * `accessIn` also states the one platform rule: a superadmin holds `admin` in every tenant
 * without a membership row. It lives here, above the repo and below the handler, so a platform
 * administrator and an ordinary member arrive at `tenantProcedure` as the same shape -- and are
 * projected into Casbin the same way, as `g, user:<uuid>, admin, <tenant>`. The alternative, a
 * second branch in the middleware, is how an authorization check drifts away from the query it
 * was meant to guard.
 *
 * Since ADR 0110 the answer also carries whether the tenant is deactivated. Authority and state
 * are two facts and stay two fields: a deactivated tenant's admin is still its admin -- that is
 * who may reactivate it -- and the refusal a deactivated tenant earns is argued in
 * `handlers/trpc.ts`, beside the 404, from the one answer this module gives.
 */

import { ADMIN_ROLE, type Permission } from "@undercroft/contracts/access";
import type { SqlExecutor } from "@undercroft/db";
import { accessFor } from "../repos/membership.ts";
import { findTenant } from "../repos/tenant.ts";
import { permissionsOf } from "./rbac.ts";
import { isSuperadmin, type Superadmins } from "./superadmin.ts";

export type { Role } from "../repos/membership.ts";

/** What a caller holds in a tenant: their role and its permissions, and the tenant's state. */
export interface Access {
  /** The role key the caller holds, for a person to read. Decide on `permissions`, never this. */
  readonly role: string;
  /** What the caller may do here, sorted -- what Casbin decided, not a copy of the grants. */
  readonly permissions: readonly Permission[];
  /** When the tenant was deactivated; `null` while it is in use. ADR 0110. */
  readonly deactivatedAt: string | null;
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
 *
 * Still one statement per request (`accessFor`): Casbin is handed what that row said and asks
 * the database nothing of its own.
 */
export async function accessIn(
  exec: SqlExecutor,
  input: { tenantId: string; userId: string; superadmin: boolean },
): Promise<Access | null> {
  const standing = input.superadmin
    ? await platformStanding(exec, input.tenantId)
    : await accessFor(exec, input.tenantId, input.userId);
  if (standing === null) {
    return null;
  }
  return {
    role: standing.role,
    permissions: await permissionsOf({
      userId: input.userId,
      tenantId: input.tenantId,
      role: standing.role,
    }),
    deactivatedAt: standing.deactivatedAt,
  };
}

/** A superadmin's standing in a tenant that exists: `admin`, and the tenant's state. */
async function platformStanding(
  exec: SqlExecutor,
  tenantId: string,
): Promise<{ role: string; deactivatedAt: string | null } | null> {
  const tenant = await findTenant(exec, tenantId);
  return tenant === null ? null : { role: ADMIN_ROLE, deactivatedAt: tenant.deactivatedAt };
}

/** Whether an access holds one permission: the question every gate asks, asked one way. */
export function holds(
  access: { readonly permissions: readonly Permission[] },
  permission: Permission,
): boolean {
  return access.permissions.includes(permission);
}

/**
 * Where a caller stands with one permission in a tenant, for a door with no middleware to ask.
 *
 * Three answers rather than a boolean, because the OAuth callback has to say WHICH refusal it
 * is: an admin of a deactivated customer is not someone lacking the permission, and reporting
 * one as the other would send a person to ask for a role they already hold. The tenant's state
 * is told only to a caller who holds the permission -- one without it learns `lacks` and nothing
 * else.
 */
export type Standing = "holds" | "lacks" | "deactivated";

/**
 * May this caller exercise `permission` in this tenant now? Membership or platform, one answer --
 * and `deactivated` for a holder in a customer that is deactivated (ADR 0110).
 *
 * The whole question in one call, because the caller that needs it most is outside tRPC.
 * `tenantProcedure` reaches `accessIn` through the middleware and cannot get this wrong;
 * the OAuth callback has no middleware, and the first cut of it asked for a membership row
 * instead -- which a superadmin deliberately has none of. The effect was a consent that a
 * platform administrator could start, that Google would grant, and that the final step then
 * refused, every time.
 *
 * So the composition lives here beside `accessIn` rather than at the wiring, where each
 * call site gets to decide again whether platform authority counts. It takes the address
 * because that, not the uuid, is what `UNDERCROFT_SUPERADMINS` names.
 */
export async function standingIn(
  exec: SqlExecutor,
  superadmins: Superadmins,
  caller: { tenantId: string; userId: string; email: string },
  permission: Permission,
): Promise<Standing> {
  const access = await accessIn(exec, {
    tenantId: caller.tenantId,
    userId: caller.userId,
    superadmin: isSuperadmin(superadmins, caller.email),
  });
  if (access === null || !holds(access, permission)) {
    return "lacks";
  }
  return access.deactivatedAt === null ? "holds" : "deactivated";
}

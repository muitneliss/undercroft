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
 * Since ADR 0141 a customer may define its own roles and grant a permission to a role or to one
 * person, optionally until a moment. Nothing here changes shape for it: the membership statement
 * reads the custom role's permissions and the grants in force, and Casbin decides over them.
 * What is new is the SUBSET RULE (`lacking`, `conferredBy`): nobody may give, take away or define
 * a permission they do not hold themselves, so `roles:manage` and `people:manage` cannot be
 * turned into every other permission by granting it to oneself or to a friend.
 *
 * Since ADR 0142 an `Access` carries the caller's REACH too -- which models, raw streams and
 * reports they may read -- and the subset rule weighs it beside the permissions (`beyond`,
 * `within`): nobody gives or takes away reading what they cannot read themselves.
 *
 * Since ADR 0110 the answer also carries whether the tenant is deactivated. Authority and state
 * are two facts and stay two fields: a deactivated tenant's admin is still its admin -- that is
 * who may reactivate it -- and the refusal a deactivated tenant earns is argued in
 * `handlers/trpc.ts`, beside the 404, from the one answer this module gives.
 */

import { ADMIN_ROLE, type Permission, type Reach, unreached } from "@undercroft/contracts/access";
import type { SqlExecutor } from "@undercroft/db";
import { rolePolicy } from "../repos/accessRoles.ts";
import { accessFor, type MemberAccess, memberIdForEmail } from "../repos/membership.ts";
import { findTenant } from "../repos/tenant.ts";
import { type Holding, holdingOf, holdingOfRole } from "./rbac.ts";
import { isSuperadmin, type Superadmins } from "./superadmin.ts";

export type { Holding } from "./rbac.ts";

export type { Role } from "../repos/membership.ts";

/** What a caller holds in a tenant: their role and its permissions, and the tenant's state. */
export interface Access {
  /** The role key the caller holds, for a person to read. Decide on `permissions`, never this. */
  readonly role: string;
  /** The customer's name for that role when it is one of its own (ADR 0141); `null` otherwise. */
  readonly roleLabel: string | null;
  /** What the caller may do here, sorted -- what Casbin decided, not a copy of the grants. */
  readonly permissions: readonly Permission[];
  /**
   * Which models, raw streams and reports the caller may read (ADR 0142), decided by Casbin
   * beside the permissions. A read is filtered or refused by it, and a reader of fewer than all
   * the models reads through a scope login (`scopeOf` in `services/bi.ts`).
   */
  readonly reach: Reach;
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
  const holding = await holdingOf({ ...standing, userId: input.userId, tenantId: input.tenantId });
  return {
    role: standing.role,
    roleLabel: standing.roleLabel,
    permissions: holding.permissions,
    reach: holding.reach,
    deactivatedAt: standing.deactivatedAt,
  };
}

/**
 * A superadmin's standing in a tenant that exists: `admin`, and the tenant's state. No grants and
 * no custom permissions: `admin` already holds the whole catalogue.
 */
async function platformStanding(exec: SqlExecutor, tenantId: string): Promise<MemberAccess | null> {
  const tenant = await findTenant(exec, tenantId);
  return tenant === null
    ? null
    : {
        role: ADMIN_ROLE,
        roleLabel: null,
        rolePermissions: [],
        grants: [],
        deactivatedAt: tenant.deactivatedAt,
      };
}

/**
 * The permissions in `involved` that `held` does not include, in catalogue order, deduplicated --
 * empty when the caller may make the change. The subset rule (ADR 0141), asked one way by every
 * procedure that defines, grants or assigns a permission: you may change only what you could
 * have created, so taking a permission away needs it held as much as giving it does.
 */
export function lacking(
  held: readonly Permission[],
  involved: readonly Permission[],
): readonly Permission[] {
  return [...new Set(involved)].filter((permission) => !held.includes(permission));
}

/** What the subset rule found beyond the caller: permissions they lack, objects they do not reach. */
export interface Beyond {
  readonly permissions: readonly Permission[];
  readonly objects: readonly string[];
}

/**
 * Everything in `involved` -- what a role confers, what a member holds -- that `held` does not:
 * the permissions it lacks and the objects it does not reach (ADR 0141, ADR 0142). Empty in both
 * when the caller may make the change. Reach counts as much as permissions: a holder of
 * `people:manage` who reads three models cannot make somebody a viewer, who reads every one.
 */
export function beyond(held: Holding, involved: readonly Holding[]): Beyond {
  return {
    permissions: lacking(
      held.permissions,
      involved.flatMap((holding) => holding.permissions),
    ),
    objects: [...new Set(involved.flatMap((holding) => unreached(held.reach, holding.reach)))],
  };
}

/** Whether `beyond` found nothing: the change is the caller's to make. */
export function within(found: Beyond): boolean {
  return found.permissions.length === 0 && found.objects.length === 0;
}

/**
 * What holding `role` confers in this tenant, as Casbin decides it -- a built-in's grants, a
 * customer's own role's permissions, the grants in force to the role, and what it reaches -- or
 * `null` when the customer has no role with that key. The question the subset rule asks before
 * anyone is invited at a role or given one.
 */
export async function conferredBy(
  exec: SqlExecutor,
  tenantId: string,
  role: string,
): Promise<Holding | null> {
  const policy = await rolePolicy(exec, tenantId, role);
  return policy === null ? null : await holdingOfRole({ ...policy, tenantId, role });
}

/**
 * What a member holds in this tenant, by address -- their role's and their own grants, and what
 * they reach -- or `null` for an address that is no member. What removing them takes away, for
 * the subset rule.
 */
export async function heldByMember(
  exec: SqlExecutor,
  tenantId: string,
  email: string,
): Promise<Holding | null> {
  const userId = await memberIdForEmail(exec, tenantId, email);
  const access =
    userId === null ? null : await accessIn(exec, { tenantId, userId, superadmin: false });
  return access === null ? null : { permissions: access.permissions, reach: access.reach };
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

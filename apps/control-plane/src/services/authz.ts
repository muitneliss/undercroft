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
 */

import type { SqlExecutor } from "@undercroft/db";
import { type Role, roleFor as roleForMember } from "../repos/membership.ts";

export type { Role };

export const ROLE_RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2 };

/** The caller's role in a tenant, or `null` when they are not a member. */
export function roleFor(exec: SqlExecutor, tenantId: string, userId: string): Promise<Role | null> {
  return roleForMember(exec, tenantId, userId);
}

/** Whether `held` carries at least the authority of `min`. */
export function outranks(held: Role, min: Role): boolean {
  return ROLE_RANK[held] >= ROLE_RANK[min];
}

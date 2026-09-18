/**
 * Which tenants a caller can see, and what one of them is called.
 *
 * `get` returns `null` for a tenant that does not exist and leaves the reporting to the
 * handler. It does not take the caller's role into account: membership has already been
 * established by `tenantProcedure` before this runs, so re-checking it here would be a
 * second authorization decision in a second place -- the way the two drift apart.
 */

import type { SqlExecutor } from "@undercroft/db";
import { listForUser, type MemberTenant } from "../repos/membership.ts";
import { findTenant, type Tenant } from "../repos/tenant.ts";

export type { MemberTenant, Tenant };

/** The tenants this user is a member of. Non-membership is invisible, not forbidden. */
export function listForCaller(exec: SqlExecutor, userId: string): Promise<MemberTenant[]> {
  return listForUser(exec, userId);
}

/** One tenant, or `null`. */
export function get(exec: SqlExecutor, tenantId: string): Promise<Tenant | null> {
  return findTenant(exec, tenantId);
}

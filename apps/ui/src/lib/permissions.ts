/**
 * What the reader may do in a customer, as the server said it (ADR 0139).
 *
 * `tenants.get` and each row of `tenants.list` answer with `permissions`: what Casbin decided for
 * this reader, sorted. The browser reads that and nothing else. It keeps no rank of roles, no
 * table of what a role holds, and never compares a role to a role's name -- the
 * `no-role-literal-gate` rule fails the gate on one -- because a copy of the policy here is a
 * second policy, and the day a customer defines its own roles (PR 2) it would be wrong for every
 * one of them while every screen still rendered.
 *
 * Every gate here is a courtesy, never the control: the server refuses what the reader lacks
 * whatever the browser drew. It exists so a reader is not shown a button that can only fail.
 */

import type { Permission } from "@undercroft/contracts/access";

export type { Permission } from "@undercroft/contracts/access";

/**
 * Whether the reader holds `permission`.
 *
 * `undefined` -- the answer not here yet, or refused -- holds nothing. A screen that must not
 * close a door on a reader it has not heard about yet asks about that separately, as `closedTo`
 * does; for a button, offering nothing until the server has spoken is the safe side.
 */
export function can(
  permissions: readonly Permission[] | undefined,
  permission: Permission,
): boolean {
  return permissions?.includes(permission) === true;
}

/**
 * Each permission's catalogue key. A map rather than a key built from the permission, because
 * i18next reads the `:` in `models:write` as a namespace separator.
 */
export const PERMISSION_LABELS = {
  "reports:author": "permission.reportsAuthor",
  "models:read": "permission.modelsRead",
  "models:write": "permission.modelsWrite",
  "lake:read": "permission.lakeRead",
  "runs:read": "permission.runsRead",
  "sources:read": "permission.sourcesRead",
  "sources:manage": "permission.sourcesManage",
  "keys:manage": "permission.keysManage",
  "catalogue:manage": "permission.catalogueManage",
  "people:manage": "permission.peopleManage",
  "audit:read": "permission.auditRead",
  "tenant:manage": "permission.tenantManage",
  "roles:manage": "permission.rolesManage",
} as const satisfies Record<Permission, `permission.${string}`>;

/**
 * What a reader holding a built-in role is told they may do -- for fixtures, which stand in for
 * the server's `tenants.get`.
 *
 * Read from the one table the server projects into Casbin, `BUILT_IN_GRANTS`, so a fixture
 * cannot go on passing against a policy the server no longer has. Product code never does this
 * (`.ast-grep/rules/no-role-literal-gate.yml` refuses `BUILT_IN_GRANTS` under `apps/ui/src`
 * outside a test): a screen reads `permissions` off the answer, through `can()`.
 */

import {
  BUILT_IN_GRANTS,
  BUILT_IN_ROLES,
  isBuiltInRole,
  PERMISSIONS,
  type Permission,
} from "@undercroft/contracts/access";

import type { ListedRole } from "@/lib/roles.ts";

/** The permissions `role` holds, sorted as the server sends them; none for a role it lacks. */
export function held(role: string): Permission[] {
  return isBuiltInRole(role) ? [...BUILT_IN_GRANTS[role]].sort() : [];
}

/**
 * The four built-ins as `roles.list` answers them for a customer with nobody else in it: each
 * one's permissions in catalogue order, as the server lists a role's, and no holders.
 */
export function builtInRoles(): ListedRole[] {
  return BUILT_IN_ROLES.map((key) => ({
    key,
    builtin: true,
    label: null,
    description: "",
    permissions: PERMISSIONS.filter((permission) => BUILT_IN_GRANTS[key].includes(permission)),
    members: 0,
    invitations: 0,
  }));
}

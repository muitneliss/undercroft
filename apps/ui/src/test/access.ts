/**
 * What a reader holding a built-in role is told they may do -- for fixtures, which stand in for
 * the server's `tenants.get`.
 *
 * Read from the one table the server projects into Casbin, `BUILT_IN_GRANTS`, so a fixture
 * cannot go on passing against a policy the server no longer has. Product code never does this
 * (`.ast-grep/rules/no-role-literal-gate.yml` refuses `BUILT_IN_GRANTS` under `apps/ui/src`
 * outside a test): a screen reads `permissions` off the answer, through `can()`.
 */

import { BUILT_IN_GRANTS, isBuiltInRole, type Permission } from "@undercroft/contracts/access";

/** The permissions `role` holds, sorted as the server sends them; none for a role it lacks. */
export function held(role: string): Permission[] {
  return isBuiltInRole(role) ? [...BUILT_IN_GRANTS[role]].sort() : [];
}

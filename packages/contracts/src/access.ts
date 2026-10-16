/**
 * Tenant access, defined once: the built-in role keys, the permissions a role can hold, and
 * which built-in holds which. ADR 0139.
 *
 * The control plane projects `BUILT_IN_GRANTS` into Casbin and Casbin evaluates
 * (`apps/control-plane/src/services/rbac.ts`); the rest is what the wire carries and every side
 * must spell the same way -- the zod enum a role is accepted through, the roster a browser
 * offers, the `permissions` array `tenants.get` answers with.
 *
 * The grants are here, below every layer, rather than in the control plane, so that one table is
 * the policy for the server AND for the browser's test fixtures, which stand in for the server's
 * answer and would otherwise carry a second copy of it that nothing kept true. The browser's
 * product code never reads the table: it reads a caller's rights from `tenants.get`, through
 * `can()`, and `.ast-grep/rules/no-role-literal-gate.yml` fails the gate on a
 * `BUILT_IN_GRANTS` anywhere under `apps/ui/src` outside a test -- a browser that computed
 * rights from a role would be wrong for every role a customer defines (PR 2).
 *
 * Its own entry point rather than a line in `index.ts`, for the reason CLAUDE.md gives about
 * `@undercroft/core/locale`: the root barrel reaches `node:fs`, which a browser bundle refuses.
 * This file imports nothing.
 */

/**
 * The roles every customer has, in order of how much each holds. The values are the words every
 * surface prints, untranslated in both languages (`.claude/rules/i18n.md`).
 *
 * `builder` is ADR 0139's: the person who fixes the dbt project -- models, macros, reference
 * tables, the raw lake they read -- without the people, the sources, the keys or the customer
 * itself, which stay an admin's (issue 481).
 */
export const BUILT_IN_ROLES = ["viewer", "member", "builder", "admin"] as const;
export type BuiltInRole = (typeof BUILT_IN_ROLES)[number];

/**
 * The role the last-admin guard protects. Named once, because the guard is the one place a role
 * key is a fact about the database rather than a bundle of permissions: a customer must keep
 * somebody holding it, or nobody is left who may manage access.
 */
export const ADMIN_ROLE = "admin" satisfies BuiltInRole;

/**
 * Every permission the platform checks, as `area:action`. A procedure past `tenantProcedure`
 * that changes or reveals more than any member may see declares exactly one of these.
 *
 * A permission is added here together with its words in both catalogues,
 * `docs/reference/permissions.md` and `skills/undercroft/references/access-control.md`
 * (`.claude/rules/access.md`); the compiler then demands the rest, because each catalogue's
 * labels are typed `Record<Permission, …>`.
 */
export const PERMISSIONS = [
  "reports:author",
  "models:write",
  "lake:read",
  "sources:manage",
  "keys:manage",
  "catalogue:manage",
  "people:manage",
  "audit:read",
  "tenant:manage",
  "roles:manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * What each built-in role holds: the policy statement `ROLE_RANK` used to be.
 *
 * Flat sets rather than a ladder of roles inheriting from each other. A ladder is what ADR 0139
 * replaced: `builder` holds `models:write` and not `people:manage`, `member` holds
 * `reports:author` and neither, and no ordering of four rungs says that. A customer's own roles
 * (PR 2) are flat sets too, so the built-ins are simply the four that ship.
 *
 * `admin` is "all of the catalogue" by construction rather than by list, so a permission added
 * tomorrow reaches the customer's admins the moment it exists -- the alternative is a permission
 * nobody can exercise until somebody remembers to grant it to the role that manages everything
 * else. `docs/reference/permissions.md` lists the procedures each permission covers.
 */
export const BUILT_IN_GRANTS: Readonly<Record<BuiltInRole, readonly Permission[]>> = {
  viewer: [],
  member: ["reports:author"],
  builder: ["reports:author", "models:write", "lake:read"],
  admin: PERMISSIONS,
};

const BUILT_IN_ROLE_SET: ReadonlySet<string> = new Set(BUILT_IN_ROLES);
const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

export function isBuiltInRole(value: string): value is BuiltInRole {
  return BUILT_IN_ROLE_SET.has(value);
}

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

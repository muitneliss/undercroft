/**
 * Casbin evaluates; our tables stay the owners. ADR 0139, ADR 0141.
 *
 * What a caller may do in a tenant is decided by Casbin's RBAC-with-domains model below, the
 * tenant being the domain. Casbin is given its policy fresh for every request, PROJECTED from
 * what the platform already holds -- the caller's membership as `accessFor` reads it in its one
 * statement (their role key, the permissions a customer's own role holds, the grants in force to
 * that role and to them) and the built-in grants (`BUILT_IN_GRANTS` in
 * `@undercroft/contracts/access`) -- and it keeps none of it. So Casbin is an evaluator and
 * nothing else, and three things it ships are refused on purpose:
 *
 * - **No stock database adapter, and no `casbin_rule` table.** An adapter opens its own pool,
 *   outside the repos and outside `undercroft_app`'s grants, and a table of its own would be a
 *   second owner of membership beside `app.tenant_member` -- one the last-admin guard, written
 *   into the SQL that changes a role (`repos/membership.ts`), would know nothing about.
 * - **No management API** (`addPolicy`, `savePolicy`, …). The adapter below loads and refuses
 *   everything else, so a call that would persist policy fails loudly instead of changing an
 *   in-memory copy that is gone at the end of the request. It fills the model through
 *   `Model.addPolicy`, the adapter contract, rather than through CSV lines: a tenant id or a role
 *   key is then a value, never text Casbin parses, so a comma in one cannot become a second rule.
 * - **No long-lived enforcer.** One per request, so there is no cache to invalidate when a role
 *   changes: a demoted admin is refused on their next call. Building one and asking it every
 *   permission measured about 0.03 ms, against the database round trip it follows.
 *
 * The request is `(subject, tenant, object, action)` -- for a permission,
 * `(user:<uuid>, CASE-0042, perm:models:write, use)`. It is the general shape on purpose: object
 * grants (PR 3) ask `(…, model:orders, read)` of the same model. A grant to a person is a `p` line
 * whose subject is `user:<uuid>` itself, which `g` matches without a role between; a grant to a
 * role is a `p` line on the role key, in the customer's domain. `keyMatch` is what lets a later
 * policy say `model:*`; on a permission object it is equality.
 *
 * **Fail closed on anything the catalogue does not know.** A custom role's stored permission, or
 * a grant's object, that is not one of `PERMISSIONS` projects no line at all -- the database
 * keeps the string (code owns the catalogue, and a permission retired tomorrow is still in
 * yesterday's rows) and this refuses to read it as anything. `permissionsOf` asks only about the
 * catalogue in any case; not writing the line is what keeps an unknown object out of `keyMatch`,
 * where a pattern could widen it.
 *
 * Subjects are prefixed (`user:`) and role keys never contain a colon, so a role key can never be
 * mistaken for a person or a person for a role.
 */

import {
  BUILT_IN_GRANTS,
  isPermission,
  PERMISSIONS,
  type Permission,
} from "@undercroft/contracts/access";
import { type Adapter, type Model, newEnforcer, newModelFromString } from "casbin";

/**
 * RBAC with domains. `g` is three-place -- person, role, tenant -- so a role holds only in the
 * tenant its membership names; `p.dom` is `*` for a grant that holds in every tenant, which is
 * what a built-in role's grants are, or a tenant id for one that customer defined.
 */
export const ACCESS_MODEL = `
[request_definition]
r = sub, dom, obj, act

[policy_definition]
p = sub, dom, obj, act

[role_definition]
g = _, _, _

[policy_effect]
e = some(where (p.eft == allow))

[matchers]
m = g(r.sub, p.sub, r.dom) && (p.dom == "*" || p.dom == r.dom) && keyMatch(r.obj, p.obj) && r.act == p.act
`;

/** One grant in force, as `accessFor` read it: to the holder's role, or to the holder. */
export interface GrantLine {
  readonly toRole: boolean;
  readonly object: string;
  readonly action: string;
}

/**
 * A role as the projection needs it in one tenant: its key, the permissions a customer's own role
 * holds as stored (empty for a built-in, whose grants are code), and the grants in force to it.
 */
export interface RolePolicy {
  readonly tenantId: string;
  readonly role: string;
  readonly rolePermissions: readonly string[];
  /** Only grants to the role are read here; a grant to a person is not the role's. */
  readonly grants: readonly GrantLine[];
}

/**
 * Who holds what in which tenant, as the membership row (or a superadmin's standing) says: the
 * role's policy, and the grants in force to the person as well as to their role.
 */
export interface Holder extends RolePolicy {
  readonly userId: string;
}

/** Every grant holds in every tenant: the built-ins are the platform's, not a customer's. */
const EVERY_TENANT = "*";
/** The action a permission is checked with; an object grant will name `read` or `write`. */
const USE = "use";

function subjectOf(userId: string): string {
  return `user:${userId}`;
}

/** The object a permission is asked and granted as: `perm:models:write`. */
export function objectOf(permission: Permission): string {
  return `${PERMISSION_OBJECT}${permission}`;
}

const PERMISSION_OBJECT = "perm:";

/**
 * The permission a stored object names, or `null` for one that names none the catalogue knows --
 * a retired permission, or (from PR 3) an object grant -- which is never read as a permission.
 */
export function permissionOfObject(object: string): Permission | null {
  if (!object.startsWith(PERMISSION_OBJECT)) {
    return null;
  }
  const permission = object.slice(PERMISSION_OBJECT.length);
  return isPermission(permission) ? permission : null;
}

/** The built-in `p` lines, derived once: they are code, and the same for every request. */
const BUILT_IN_POLICY: readonly (readonly string[])[] = Object.entries(BUILT_IN_GRANTS).flatMap(
  ([role, permissions]) =>
    permissions.map((permission) => [role, EVERY_TENANT, objectOf(permission), USE]),
);

/** What every write to the projection answers: there is nowhere for policy to be written to. */
function refused(method: string): Promise<never> {
  return Promise.reject(
    new Error(`casbin policy is projected per request and never written (${method}); ADR 0139`),
  );
}

/**
 * A load-only adapter over policy the caller already holds. Every write refuses, because there is
 * nowhere for it to go: the owners are our tables, written through their repos. A plain object
 * rather than a class: it holds no state beyond the two lists it closes over.
 */
function projected(
  policy: readonly (readonly string[])[],
  grouping: readonly (readonly string[])[],
): Adapter {
  return {
    loadPolicy: (model: Model): Promise<void> => {
      for (const rule of policy) {
        model.addPolicy("p", "p", [...rule]);
      }
      for (const rule of grouping) {
        model.addPolicy("g", "g", [...rule]);
      }
      return Promise.resolve();
    },
    savePolicy: () => refused("savePolicy"),
    addPolicy: () => refused("addPolicy"),
    removePolicy: () => refused("removePolicy"),
    removeFilteredPolicy: () => refused("removeFilteredPolicy"),
  };
}

/**
 * The `p` lines one tenant's policy adds to the built-ins: the custom role's permissions and every
 * grant, in the tenant's domain. A permission or object the catalogue does not know writes no
 * line (see the module's docstring), and nor does a grant to a person when `person` is `null` --
 * the question is then about the role alone.
 */
function tenantPolicy(policy: RolePolicy, person: string | null): string[][] {
  const custom = policy.rolePermissions
    .filter((permission) => isPermission(permission))
    .map((permission) => [policy.role, policy.tenantId, objectOf(permission), USE]);
  const granted = policy.grants.flatMap((grant) => {
    const subject = grant.toRole ? policy.role : person;
    return subject !== null && permissionOfObject(grant.object) !== null
      ? [[subject, policy.tenantId, grant.object, grant.action]]
      : [];
  });
  return [...custom, ...granted];
}

/** Ask the projected policy every catalogue permission for `subject`, sorted. */
async function decided(
  subject: string,
  tenantId: string,
  policy: readonly (readonly string[])[],
  grouping: readonly (readonly string[])[],
): Promise<readonly Permission[]> {
  const enforcer = await newEnforcer(
    newModelFromString(ACCESS_MODEL),
    projected([...BUILT_IN_POLICY, ...policy], grouping),
  );
  return PERMISSIONS.filter((permission) =>
    enforcer.enforceSync(subject, tenantId, objectOf(permission), USE),
  ).toSorted((a, b) => a.localeCompare(b));
}

/**
 * The permissions `holder` holds in their tenant, sorted.
 *
 * Every permission in the catalogue is asked of the enforcer, rather than the grants read back,
 * so the answer is what Casbin decides and not a second evaluation beside it: a per-user grant, a
 * customer's own role and a grant to a role all reach the answer only by being policy lines, so
 * this reports exactly what the gate will let through.
 */
export function permissionsOf(holder: Holder): Promise<readonly Permission[]> {
  const person = subjectOf(holder.userId);
  return decided(person, holder.tenantId, tenantPolicy(holder, person), [
    [person, holder.role, holder.tenantId],
  ]);
}

/**
 * What holding `role` confers in its tenant, sorted: its own permissions and the grants in force
 * to it, as Casbin decides them -- the question the subset rule asks before anyone is given the
 * role (ADR 0141). The role key is the subject itself, which `g` matches without a person between.
 */
export function permissionsOfRole(role: RolePolicy): Promise<readonly Permission[]> {
  return decided(role.role, role.tenantId, tenantPolicy(role, null), []);
}

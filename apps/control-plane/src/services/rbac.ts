/**
 * Casbin evaluates; our tables stay the owners. ADR 0139.
 *
 * What a caller may do in a tenant is decided by Casbin's RBAC-with-domains model below, the
 * tenant being the domain. Casbin is given its policy fresh for every request, PROJECTED from
 * what the platform already holds -- the caller's role from `app.tenant_member` (the one
 * statement `accessFor` already runs) and the built-in grants (`BUILT_IN_GRANTS` in
 * `@undercroft/contracts/access`) -- and it
 * keeps none of it. So Casbin is an evaluator and nothing else, and three things it ships are
 * refused on purpose:
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
 * grants (PR 3) ask `(…, model:orders, read)` of the same model, and a per-user grant (PR 2) is a
 * `p` line whose subject is `user:<uuid>` itself, which `g` matches without a role between.
 * `keyMatch` is what lets a later policy say `model:*`; on a permission object it is equality.
 *
 * Subjects are prefixed (`user:`) and role keys never contain a colon, so a role key can never be
 * mistaken for a person or a person for a role.
 */

import { BUILT_IN_GRANTS, PERMISSIONS, type Permission } from "@undercroft/contracts/access";
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

/** Who holds what in which tenant, as the membership row (or a superadmin's standing) says. */
export interface Holder {
  readonly userId: string;
  readonly tenantId: string;
  /** The role key. A key with no grants -- none exists in PR 1 -- projects and holds nothing. */
  readonly role: string;
}

/** Every grant holds in every tenant: the built-ins are the platform's, not a customer's. */
const EVERY_TENANT = "*";
/** The action a permission is checked with; an object grant will name `read` or `write`. */
const USE = "use";

function subjectOf(userId: string): string {
  return `user:${userId}`;
}

function objectOf(permission: Permission): string {
  return `perm:${permission}`;
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
 * The permissions `holder` holds in their tenant, sorted.
 *
 * Every permission in the catalogue is asked of the enforcer, rather than the grants table read
 * back, so the answer is what Casbin decides and not a second evaluation beside it: the day a
 * policy line is added that the table does not mention -- a per-user grant, a customer's own
 * role -- this still reports exactly what the gate will let through.
 */
export async function permissionsOf(holder: Holder): Promise<readonly Permission[]> {
  const enforcer = await newEnforcer(
    newModelFromString(ACCESS_MODEL),
    projected(BUILT_IN_POLICY, [[subjectOf(holder.userId), holder.role, holder.tenantId]]),
  );
  const subject = subjectOf(holder.userId);
  return PERMISSIONS.filter((permission) =>
    enforcer.enforceSync(subject, holder.tenantId, objectOf(permission), USE),
  ).toSorted((a, b) => a.localeCompare(b));
}

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
 * `(user:<uuid>, CASE-0042, perm:models:write, use)`, and for an object grant (ADR 0142)
 * `(…, model:orders, read)`, of the same model. A grant to a person is a `p` line
 * whose subject is `user:<uuid>` itself, which `g` matches without a role between; a grant to a
 * role is a `p` line on the role key, in the customer's domain. `keyMatch` is what lets a later
 * policy say `model:*`; on a permission object it is equality.
 *
 * **Fail closed on anything the catalogue does not know.** A custom role's stored permission, or
 * a grant's object, that is not one of `PERMISSIONS` -- or, from ADR 0142, not an object of the
 * reach grammar (`parseReachObject`) with `read` -- projects no line at all. The database keeps
 * the string (code owns the catalogue, and a permission retired tomorrow is still in yesterday's
 * rows) and this refuses to read it as anything. `holdingOf` asks only about the catalogue and
 * the objects the projected lines name; not writing the line is what keeps an unknown object out
 * of `keyMatch`, where a pattern could widen it. The grammar puts a `*` only where it means "the
 * whole of" (`model:*`, `raw:<source>/*`), so a line that IS written is as wide as it reads.
 *
 * **Reach** (ADR 0142). Beside the permissions, Casbin decides what a holder may READ: which
 * models, raw streams and reports. Every built-in role reaches the whole customer -- a `p` line
 * on `model:*`, `raw:*` and `report:*` each, like its permissions in code -- and a customer's own
 * role reaches only what is granted to it, a grant to a person adding to whatever their role
 * reaches. The answer is a `Reach`: for each domain, its wildcard asked of the enforcer, and if
 * that is refused, every object of the domain a projected line names, each asked in turn. So a
 * reach, like a permission, is what the enforcer decided, never the grants read back.
 *
 * Subjects are prefixed (`user:`) and role keys never contain a colon, so a role key can never be
 * mistaken for a person or a person for a role.
 */

import {
  BUILT_IN_GRANTS,
  isPermission,
  PERMISSIONS,
  type Permission,
  parseReachObject,
  READ_ACTION,
  REACH_DOMAINS,
  type Reach,
  type ReachObject,
  USE_ACTION,
  wholeObject,
} from "@undercroft/contracts/access";
import { type Adapter, type Enforcer, type Model, newEnforcer, newModelFromString } from "casbin";

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
/** The action a permission is checked with. */
const USE = USE_ACTION;
/** The action an object grant is checked with. */
const READ = READ_ACTION;

/**
 * What a holder holds in a tenant, as Casbin decided it: the permissions they may exercise and
 * the models, raw streams and reports they may read (ADR 0142).
 */
export interface Holding {
  readonly permissions: readonly Permission[];
  readonly reach: Reach;
}

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
 * a retired permission, or an object grant (ADR 0142) -- which is never read as a permission.
 */
export function permissionOfObject(object: string): Permission | null {
  if (!object.startsWith(PERMISSION_OBJECT)) {
    return null;
  }
  const permission = object.slice(PERMISSION_OBJECT.length);
  return isPermission(permission) ? permission : null;
}

/**
 * The built-in `p` lines, derived once: they are code, and the same for every request. Each
 * built-in role holds its permissions and reaches the whole customer -- every model, the whole raw
 * lake, every report -- as every member did before reach existed (ADR 0142). A permission still
 * gates what they may do with it: a viewer reaches the raw lake and lacks `lake:read`.
 */
const BUILT_IN_POLICY: readonly (readonly string[])[] = Object.entries(BUILT_IN_GRANTS).flatMap(
  ([role, permissions]) => [
    ...permissions.map((permission) => [role, EVERY_TENANT, objectOf(permission), USE]),
    ...REACH_DOMAINS.map((domain) => [role, EVERY_TENANT, wholeObject(domain), READ]),
  ],
);

/**
 * Whether a stored grant may become a policy line: a catalogue permission with `use`, or an
 * object of the reach grammar with `read`. Anything else -- a pattern, a retired permission, an
 * object with the other action -- projects nothing.
 */
function projectable(grant: GrantLine): boolean {
  if (grant.action === USE) {
    return permissionOfObject(grant.object) !== null;
  }
  return grant.action === READ && parseReachObject(grant.object) !== null;
}

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
    return subject !== null && projectable(grant)
      ? [[subject, policy.tenantId, grant.object, grant.action]]
      : [];
  });
  return [...custom, ...granted];
}

/** The named objects a subject reaches in each domain, gathered from the lines Casbin admitted. */
interface Named {
  readonly models: Set<string>;
  readonly sources: Set<string>;
  readonly streams: Map<string, { readonly source: string; readonly entity: string }>;
  readonly questions: Set<string>;
  readonly dashboards: Set<string>;
}

function gather(named: Named, object: ReachObject): void {
  if (object.domain === "model") {
    if (object.name !== null) {
      named.models.add(object.name);
    }
  } else if (object.domain === "raw") {
    if (object.source !== null && object.entity === null) {
      named.sources.add(object.source);
    } else if (object.source !== null && object.entity !== null) {
      const stream = { source: object.source, entity: object.entity };
      named.streams.set(`${stream.source}/${stream.entity}`, stream);
    }
  } else if (object.report !== null) {
    (object.report.kind === "question" ? named.questions : named.dashboards).add(object.report.id);
  }
}

/** Sorted by code unit: the order an answer is compared and hashed in. */
function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

/**
 * What `subject` reaches, decided object by object (see the module's docstring). A domain's
 * wildcard is asked first; if Casbin refuses it, the candidates are the objects the projected
 * lines name, each asked in turn -- so an object nobody granted is never asked about, and a line
 * Casbin does not admit for this subject (a grant to somebody else) adds nothing.
 */
function reachOf(
  enforcer: Enforcer,
  subject: string,
  tenantId: string,
  lines: readonly (readonly string[])[],
): Reach {
  function reaches(object: string): boolean {
    return enforcer.enforceSync(subject, tenantId, object, READ);
  }
  const named: Named = {
    models: new Set(),
    sources: new Set(),
    streams: new Map(),
    questions: new Set(),
    dashboards: new Set(),
  };
  for (const line of lines) {
    const object = line[2] ?? "";
    const parsed = line[3] === READ ? parseReachObject(object) : null;
    if (parsed !== null && reaches(object)) {
      gather(named, parsed);
    }
  }
  const streams = [...named.streams.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  return {
    models: reaches(wholeObject("model")) ? "all" : sorted(named.models),
    raw: reaches(wholeObject("raw"))
      ? "all"
      : { sources: sorted(named.sources), streams: streams.map(([, stream]) => stream) },
    reports: reaches(wholeObject("report"))
      ? "all"
      : { questions: sorted(named.questions), dashboards: sorted(named.dashboards) },
  };
}

/** Ask the projected policy every catalogue permission, and every object, for `subject`. */
async function decided(
  subject: string,
  tenantId: string,
  policy: readonly (readonly string[])[],
  grouping: readonly (readonly string[])[],
): Promise<Holding> {
  const lines = [...BUILT_IN_POLICY, ...policy];
  const enforcer = await newEnforcer(newModelFromString(ACCESS_MODEL), projected(lines, grouping));
  return {
    permissions: PERMISSIONS.filter((permission) =>
      enforcer.enforceSync(subject, tenantId, objectOf(permission), USE),
    ).toSorted((a, b) => a.localeCompare(b)),
    reach: reachOf(enforcer, subject, tenantId, lines),
  };
}

/**
 * What `holder` holds in their tenant: the permissions, sorted, and what they reach.
 *
 * Every permission in the catalogue is asked of the enforcer, rather than the grants read back,
 * so the answer is what Casbin decides and not a second evaluation beside it: a per-user grant, a
 * customer's own role and a grant to a role all reach the answer only by being policy lines, so
 * this reports exactly what the gate will let through. Reach is asked the same way.
 */
export function holdingOf(holder: Holder): Promise<Holding> {
  const person = subjectOf(holder.userId);
  return decided(person, holder.tenantId, tenantPolicy(holder, person), [
    [person, holder.role, holder.tenantId],
  ]);
}

/**
 * What holding `role` confers in its tenant: its own permissions and the grants in force to it,
 * as Casbin decides them, and what it reaches -- the question the subset rule asks before anyone
 * is given the role (ADR 0141, ADR 0142). The role key is the subject itself, which `g` matches
 * without a person between.
 */
export function holdingOfRole(role: RolePolicy): Promise<Holding> {
  return decided(role.role, role.tenantId, tenantPolicy(role, null), []);
}

/**
 * The roles a customer has: the four built-ins, and the ones it defines itself. ADR 0141.
 *
 * A customer's own role is a key, a label it chose, a description and a flat set of permissions
 * from the catalogue -- the same shape as a built-in, which is why both are listed together and
 * assigned the same way (`people.invite`, `people.setRole`). What a role confers is decided by
 * Casbin over the stored row (`rbac.ts`); this module decides whether a caller may define,
 * change or delete one.
 *
 * **The subset rule.** A caller may save a role only when they hold every permission it will hold
 * AND every permission it held before -- you may change only what you could have created -- and
 * may delete one only when they hold every permission it and the grants to it hold. Without it,
 * `roles:manage` would be every permission: define a role holding `keys:manage`, ask someone with
 * `people:manage` to assign it, or hold `people:manage` yourself. What the role holds at the
 * moment of writing is guarded in the statement, under the row's lock (`repos/accessRoles.ts`),
 * so a concurrent edit cannot slip a permission past it.
 *
 * **Built-ins are code.** Saving or deleting `viewer`, `member`, `builder` or `admin` is refused
 * before anything is read: their grants are `BUILT_IN_GRANTS`, and a customer that wants
 * something else defines its own role. The database refuses it too (`access_role_builtin_keys`).
 *
 * **In use is not deleted.** A role somebody holds, or an open invitation names, is refused with
 * the counts, so the reader knows how many people to move first. The foreign key from
 * `app.tenant_member` refuses it in the database in any case.
 *
 * Every outcome is a value; the handler words the refusals. The audit row records the role as it
 * was and as it became, never more than the role itself.
 */

import {
  BUILT_IN_GRANTS,
  isBuiltInRole,
  isPermission,
  PERMISSIONS,
  type Permission,
} from "@undercroft/contracts/access";
import type { SqlExecutor } from "@undercroft/db";
import {
  deleteRole,
  findRole,
  insertRole,
  listRoles,
  type RoleContent,
  type RoleRow,
  updateRole,
} from "../repos/accessRoles.ts";
import { type Actor, record as recordAudit } from "../repos/auditLog.ts";
import { lacking } from "./authz.ts";
import { mapNarrowed, type NameFilter, type Narrowed, narrowByName } from "./listFilter.ts";
import { objectOf, permissionOfObject } from "./rbac.ts";

/** One role as every member may read it. */
export interface RoleItem {
  readonly key: string;
  readonly builtin: boolean;
  /** The customer's name for its own role, untranslated; `null` for a built-in. */
  readonly label: string | null;
  readonly description: string;
  /**
   * What the role itself holds, in catalogue order: a built-in's grants, or a customer's role's
   * stored permissions the catalogue still knows -- one it no longer knows confers nothing and is
   * not listed. A grant to the role is not included; `grants.list` shows those.
   */
  readonly permissions: readonly Permission[];
  readonly members: number;
  readonly invitations: number;
  readonly updatedAt: string;
  readonly updatedBy: string | null;
}

/** In catalogue order, each once: how a role's permissions are stored and answered. */
function inCatalogueOrder(permissions: readonly string[]): Permission[] {
  const given = new Set(permissions);
  return PERMISSIONS.filter((permission) => given.has(permission));
}

function item(row: RoleRow): RoleItem {
  return {
    key: row.key,
    builtin: row.builtin,
    label: row.label,
    description: row.description,
    permissions:
      row.builtin && isBuiltInRole(row.key)
        ? inCatalogueOrder(BUILT_IN_GRANTS[row.key])
        : inCatalogueOrder(row.permissions ?? []),
    members: row.members,
    invitations: row.invitations,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

/** The customer's roles, built-ins first, narrowed by key (`listFilter.ts`). */
export async function list(
  exec: SqlExecutor,
  tenantId: string,
  filter: NameFilter = {},
): Promise<Narrowed<RoleItem>> {
  const rows = await listRoles(exec, tenantId);
  return mapNarrowed(
    narrowByName(rows, (row) => row.key, filter),
    item,
  );
}

/** One role, or `null` when the customer has no role with that key. */
export async function get(
  exec: SqlExecutor,
  tenantId: string,
  key: string,
): Promise<RoleItem | null> {
  const row = await findRole(exec, tenantId, key);
  return row === null ? null : item(row);
}

export type SaveOutcome =
  | { readonly ok: true; readonly unchanged: boolean }
  /** The key is a built-in's: their grants are code. */
  | { readonly ok: false; readonly reason: "built-in" }
  /** `create` was asked and the customer already has a role with that key. */
  | { readonly ok: false; readonly reason: "taken" }
  /** The caller lacks these, which the role would hold or holds now. */
  | { readonly ok: false; readonly reason: "not-held"; readonly lacking: readonly Permission[] };

/** The role as an audit row records it: what a reader of the trail needs to see what changed. */
interface Recorded {
  readonly label: string | null;
  readonly description: string;
  readonly permissions: readonly string[] | null;
}

function recorded(role: Recorded): Recorded {
  return { label: role.label, description: role.description, permissions: role.permissions };
}

/** What `save` is asked, and what every step after its first checks shares. */
interface SaveInput {
  readonly tenantId: string;
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly permissions: readonly Permission[];
  readonly create: boolean;
  readonly held: readonly Permission[];
  readonly actor: Actor;
  readonly actorId: string;
}

/** The role as it will be stored: its permissions each once, in catalogue order. */
type Content = RoleContent & { readonly permissions: Permission[] };

async function recordSave(
  exec: SqlExecutor,
  input: SaveInput,
  before: Recorded | null,
  after: Content,
): Promise<void> {
  await recordAudit(exec, {
    tenantId: input.tenantId,
    actor: input.actor,
    action: "roles.save",
    detail: JSON.stringify({
      key: input.key,
      before: before === null ? null : recorded(before),
      after: recorded(after),
    }),
  });
}

/**
 * Replace a role the customer has, under the subset rule held in the statement; `null` when it has
 * none with that key, for the caller to create. Found and not written is either identical content
 * or a stored permission the caller lacks -- told apart from what the statement found.
 */
async function replace(
  exec: SqlExecutor,
  input: SaveInput,
  content: Content,
): Promise<SaveOutcome | null> {
  const lacks = PERMISSIONS.filter((permission) => !input.held.includes(permission));
  const edit = await updateRole(exec, input.tenantId, content, lacks);
  if (edit.found === null) {
    return null;
  }
  if (edit.found.builtin) {
    return { ok: false, reason: "built-in" };
  }
  if (edit.done) {
    await recordSave(exec, input, edit.found, content);
    return { ok: true, unchanged: false };
  }
  const taken = lacking(input.held, (edit.found.permissions ?? []).filter(isPermission));
  return taken.length > 0
    ? { ok: false, reason: "not-held", lacking: taken }
    : { ok: true, unchanged: true };
}

/**
 * Define a role, or change one the customer defined. With `create`, a key already in use is
 * refused and nothing is written; without, the role is created or replaced. Content identical to
 * what is stored is `unchanged`, written and recorded nowhere, as a seed's or a macro's is.
 *
 * `held` is the caller's own permissions, from the request's context: the subset rule's input.
 */
export async function save(exec: SqlExecutor, input: SaveInput): Promise<SaveOutcome> {
  if (isBuiltInRole(input.key)) {
    return { ok: false, reason: "built-in" };
  }
  const content: Content = {
    key: input.key,
    label: input.label,
    description: input.description,
    permissions: inCatalogueOrder(input.permissions),
    updatedBy: input.actorId,
  };
  const beyond = lacking(input.held, content.permissions);
  if (beyond.length > 0) {
    return { ok: false, reason: "not-held", lacking: beyond };
  }
  const replaced = input.create ? null : await replace(exec, input, content);
  if (replaced !== null) {
    return replaced;
  }
  if (!(await insertRole(exec, input.tenantId, content))) {
    return { ok: false, reason: "taken" };
  }
  await recordSave(exec, input, null, content);
  return { ok: true, unchanged: false };
}

export type RemoveOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "built-in" | "not-found" }
  | {
      readonly ok: false;
      readonly reason: "in-use";
      readonly members: number;
      readonly invitations: number;
    }
  | { readonly ok: false; readonly reason: "not-held"; readonly lacking: readonly Permission[] };

/**
 * Delete a role the customer defined, and every grant to it, unless somebody holds it, an open
 * invitation names it, or the caller lacks a permission it or a grant to it holds.
 *
 * A closed invitation at the role goes with it (`600_custom_roles.sql` says why); its record
 * stays in the audit log.
 */
export async function remove(
  exec: SqlExecutor,
  input: { tenantId: string; key: string; held: readonly Permission[]; actor: Actor },
): Promise<RemoveOutcome> {
  if (isBuiltInRole(input.key)) {
    return { ok: false, reason: "built-in" };
  }
  const lacks = PERMISSIONS.filter((permission) => !input.held.includes(permission));
  const { found, done } = await deleteRole(exec, input.tenantId, input.key, {
    permissions: lacks,
    objects: lacks.map(objectOf),
  });
  if (found === null) {
    return { ok: false, reason: "not-found" };
  }
  if (found.builtin) {
    return { ok: false, reason: "built-in" };
  }
  if (done) {
    await recordAudit(exec, {
      tenantId: input.tenantId,
      actor: input.actor,
      action: "roles.delete",
      detail: JSON.stringify({
        key: input.key,
        before: { ...recorded(found), grants: found.grantObjects },
        after: null,
      }),
    });
    return { ok: true };
  }
  const involved = [
    ...(found.permissions ?? []).filter(isPermission),
    ...found.grantObjects.map(permissionOfObject).filter((permission) => permission !== null),
  ];
  const beyond = lacking(input.held, involved);
  if (beyond.length > 0) {
    return { ok: false, reason: "not-held", lacking: inCatalogueOrder(beyond) };
  }
  return {
    ok: false,
    reason: "in-use",
    members: found.members,
    invitations: found.invitations,
  };
}

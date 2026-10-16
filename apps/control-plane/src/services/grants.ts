/**
 * Grants: one permission given to a role or to one member, standing or until a moment. ADR 0141.
 *
 * A grant is how a customer says "Lan may read the raw lake until the end of the month" without
 * defining a role for one person, or "every member here may author reports and read the raw
 * lake" without editing a built-in. It is a Casbin `p` line like a role's (`rbac.ts`), and the
 * membership statement reads only the ones in force, by the database's clock: an expired grant
 * holds nothing on the next request, with nothing to sweep.
 *
 * **Who may.** Reading the grants needs `people:manage`, because they say who holds what -- the
 * same reason the roster does (ADR 0119). Giving or taking one away needs `roles:manage` and the
 * subset rule: the caller holds the permission themselves. Taking one away needs it as much as
 * giving it, because removing what you could not have given is changing access you do not
 * manage.
 *
 * **A person is named by address**, as `people.setRole` names them, and must be a member: a
 * grant to somebody who cannot reach the customer could never be exercised, and the foreign key
 * onto their membership removes it when they are removed (`600_custom_roles.sql`).
 *
 * In this change a grant's object is a permission and its action `use`; object grants on a model,
 * a raw stream or a report (ADR 0139's PR 3) add objects to the same table and the same shape.
 */

import { PERMISSIONS, type Permission } from "@undercroft/contracts/access";
import type { SqlExecutor } from "@undercroft/db";
import {
  deleteGrant,
  type GrantRow,
  type GrantSubject,
  listGrants,
  saveGrant,
} from "../repos/accessGrants.ts";
import { rolePolicy } from "../repos/accessRoles.ts";
import { type Actor, record as recordAudit } from "../repos/auditLog.ts";
import { memberIdForEmail } from "../repos/membership.ts";
import { lacking } from "./authz.ts";
import { objectOf, permissionOfObject } from "./rbac.ts";

/** The action a permission is granted with; an object grant (PR 3) will name `read`. */
const USE = "use";

/** One grant as an administrator reads it. */
export interface GrantItem {
  readonly id: string;
  readonly subject: "role" | "user";
  /** The role's key, for a grant to a role. */
  readonly role: string | null;
  /** The member's address, for a grant to a person. */
  readonly email: string | null;
  /**
   * The permission granted; `null` for an object the catalogue does not know -- a permission
   * since retired -- which holds nothing and is listed so that it can be removed.
   */
  readonly permission: Permission | null;
  readonly object: string;
  readonly action: string;
  readonly expiresAt: string | null;
  readonly expired: boolean;
  readonly grantedBy: string | null;
  readonly createdAt: string;
}

function item(row: GrantRow): GrantItem {
  return {
    id: row.id,
    subject: row.subjectKind,
    role: row.role,
    email: row.email,
    permission: permissionOfObject(row.object),
    object: row.object,
    action: row.action,
    expiresAt: row.expiresAt,
    expired: row.expired,
    grantedBy: row.grantedBy,
    createdAt: row.createdAt,
  };
}

/** Who a request names: a role by key, or a member by address -- exactly one. */
export interface NamedSubject {
  readonly role?: string | undefined;
  readonly email?: string | undefined;
}

type Resolved =
  | { readonly ok: true; readonly subject: GrantSubject }
  | { readonly ok: false; readonly reason: "one-subject" | "no-such-role" | "not-member" };

/** The subject a request names, resolved against what the customer has. */
async function resolve(
  exec: SqlExecutor,
  tenantId: string,
  named: NamedSubject,
): Promise<Resolved> {
  if ((named.role === undefined) === (named.email === undefined)) {
    return { ok: false, reason: "one-subject" };
  }
  if (named.role !== undefined) {
    return (await rolePolicy(exec, tenantId, named.role)) === null
      ? { ok: false, reason: "no-such-role" }
      : { ok: true, subject: { kind: "role", role: named.role } };
  }
  const userId = await memberIdForEmail(exec, tenantId, named.email ?? "");
  return userId === null
    ? { ok: false, reason: "not-member" }
    : { ok: true, subject: { kind: "user", userId } };
}

export type ListOutcome =
  | { readonly ok: true; readonly grants: GrantItem[] }
  | { readonly ok: false; readonly reason: "one-subject" | "no-such-role" | "not-member" };

/** Every grant in the customer, expired ones included, or those to one named subject. */
export async function list(
  exec: SqlExecutor,
  tenantId: string,
  named: NamedSubject,
): Promise<ListOutcome> {
  if (named.role === undefined && named.email === undefined) {
    return { ok: true, grants: (await listGrants(exec, tenantId, null)).map(item) };
  }
  const resolved = await resolve(exec, tenantId, named);
  if (!resolved.ok) {
    return resolved;
  }
  return { ok: true, grants: (await listGrants(exec, tenantId, resolved.subject)).map(item) };
}

export type SaveOutcome =
  | { readonly ok: true; readonly id: string; readonly unchanged: boolean }
  | { readonly ok: false; readonly reason: "one-subject" | "no-such-role" | "not-member" }
  /** The expiry is not in the future: a grant that is over before it starts grants nothing. */
  | { readonly ok: false; readonly reason: "expired" }
  | { readonly ok: false; readonly reason: "not-held"; readonly lacking: readonly Permission[] };

/**
 * Give `permission` to a role or a member, standing (`expiresAt` null) or until `expiresAt`.
 * The same grant stored already has its expiry moved; an identical one is `unchanged`.
 */
export async function save(
  exec: SqlExecutor,
  input: NamedSubject & {
    tenantId: string;
    permission: Permission;
    expiresAt: string | null;
    held: readonly Permission[];
    now: Date;
    actor: Actor;
    actorId: string;
  },
): Promise<SaveOutcome> {
  const beyond = lacking(input.held, [input.permission]);
  if (beyond.length > 0) {
    return { ok: false, reason: "not-held", lacking: beyond };
  }
  if (input.expiresAt !== null && new Date(input.expiresAt) <= input.now) {
    return { ok: false, reason: "expired" };
  }
  const resolved = await resolve(exec, input.tenantId, input);
  if (!resolved.ok) {
    return resolved;
  }
  const saved = await saveGrant(exec, {
    tenantId: input.tenantId,
    subject: resolved.subject,
    object: objectOf(input.permission),
    action: USE,
    expiresAt: input.expiresAt,
    grantedBy: input.actorId,
  });
  if (saved.written) {
    await recordAudit(exec, {
      tenantId: input.tenantId,
      actor: input.actor,
      action: "grants.save",
      detail: JSON.stringify({
        id: saved.id,
        role: input.role ?? null,
        email: input.email ?? null,
        permission: input.permission,
        before: saved.existed ? { expiresAt: saved.previousExpiresAt } : null,
        after: { expiresAt: input.expiresAt },
      }),
    });
  }
  return { ok: true, id: saved.id, unchanged: !saved.written };
}

export type RemoveOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "not-found" }
  | { readonly ok: false; readonly reason: "not-held"; readonly lacking: readonly Permission[] };

/** Take one grant away, unless it gives a permission the caller does not hold. */
export async function remove(
  exec: SqlExecutor,
  input: { tenantId: string; id: string; held: readonly Permission[]; actor: Actor },
): Promise<RemoveOutcome> {
  const lacks = lacking(input.held, PERMISSIONS).map(objectOf);
  const { found, done } = await deleteGrant(exec, input.tenantId, input.id, lacks);
  if (found === null) {
    return { ok: false, reason: "not-found" };
  }
  if (!done) {
    const permission = permissionOfObject(found.object);
    return { ok: false, reason: "not-held", lacking: permission === null ? [] : [permission] };
  }
  await recordAudit(exec, {
    tenantId: input.tenantId,
    actor: input.actor,
    action: "grants.delete",
    detail: JSON.stringify({
      id: input.id,
      before: {
        role: found.role,
        email: found.email,
        object: found.object,
        expiresAt: found.expiresAt,
      },
      after: null,
    }),
  });
  return { ok: true };
}

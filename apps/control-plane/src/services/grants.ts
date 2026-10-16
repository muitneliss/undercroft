/**
 * Grants: one permission, or reading one thing, given to a role or to one member, standing or
 * until a moment. ADR 0141, ADR 0142.
 *
 * A grant is how a customer says "Lan may read the raw lake until the end of the month" without
 * defining a role for one person, or "every member here may author reports and read the raw
 * lake" without editing a built-in. It is a Casbin `p` line like a role's (`rbac.ts`), and the
 * membership statement reads only the ones in force, by the database's clock: an expired grant
 * holds nothing on the next request, with nothing to sweep.
 *
 * **Two kinds, one table** (ADR 0142). A PERMISSION grant (`perm:models:write`, `use`) says what
 * a person may do; an OBJECT grant (`model:fct_sales`, `raw:hubspot/deals`,
 * `report:question:<uuid>`, or the whole of one -- `model:*`) says what they may read, with
 * `read`. A customer's own role reaches only the objects granted to it; a built-in reaches the
 * whole customer in code, and a grant to a person adds to whatever their role reaches.
 *
 * **Who may.** Reading the grants needs `people:manage`, because they say who holds what -- the
 * same reason the roster does (ADR 0119). Giving or taking one away needs `roles:manage` and the
 * subset rule: the caller holds the permission themselves, or reaches the object -- `model:*`
 * only if they reach every model. Taking one away needs it as much as giving it, because removing
 * what you could not have given is changing access you do not manage.
 *
 * **What an object grant names must exist**, when it names one thing: a model or reference
 * table, a question, a dashboard. A raw stream need not -- a grant on a source not yet connected
 * is how an admin prepares for it. The grant goes when the thing it names is deleted
 * (`610_object_grants.sql`), and a dangling one projects nothing in any case.
 *
 * **A person is named by address**, as `people.setRole` names them, and must be a member: a
 * grant to somebody who cannot reach the customer could never be exercised, and the foreign key
 * onto their membership removes it when they are removed (`600_custom_roles.sql`).
 */

import type { Permission } from "@undercroft/contracts/access";
import type { SqlExecutor } from "@undercroft/db";
import {
  deleteGrant,
  findGrant,
  type GrantRow,
  type GrantSubject,
  listGrants,
  saveGrant,
} from "../repos/accessGrants.ts";
import { rolePolicy } from "../repos/accessRoles.ts";
import { type Actor, record as recordAudit } from "../repos/auditLog.ts";
import { memberIdForEmail } from "../repos/membership.ts";
import { type Beyond, conferredBy, type Holding, heldByMember, within } from "./authz.ts";
import { beyondFor, exists, grantedBy, type NamedGrant } from "./grantObjects.ts";
import { permissionOfObject } from "./rbac.ts";

/** One grant as an administrator reads it. */
export interface GrantItem {
  readonly id: string;
  readonly subject: "role" | "user";
  /** The role's key, for a grant to a role. */
  readonly role: string | null;
  /** The member's address, for a grant to a person. */
  readonly email: string | null;
  /**
   * The permission granted; `null` for an object grant, and for an object the catalogue does not
   * know -- a permission since retired -- which holds nothing and is listed so it can be removed.
   */
  readonly permission: Permission | null;
  /** As stored: `perm:models:write`, `model:fct_sales`, `raw:*`. */
  readonly object: string;
  /** `use` for a permission, `read` for an object. */
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

type SubjectRefusal = "one-subject" | "no-such-role" | "not-member";

type Resolved =
  | { readonly ok: true; readonly subject: GrantSubject }
  | { readonly ok: false; readonly reason: SubjectRefusal };

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
  | { readonly ok: false; readonly reason: SubjectRefusal };

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

/** The subset rule's refusal, as every outcome here carries it. */
interface NotHeld {
  readonly ok: false;
  readonly reason: "not-held";
  readonly lacking: readonly Permission[];
  readonly objects: readonly string[];
}

function notHeld(found: Beyond): NotHeld {
  return { ok: false, reason: "not-held", lacking: found.permissions, objects: found.objects };
}

export type SaveOutcome =
  | { readonly ok: true; readonly id: string; readonly unchanged: boolean }
  /** Neither or both of a permission and an object; or an object the grammar does not admit. */
  | { readonly ok: false; readonly reason: SubjectRefusal | "one-object" | "unknown-object" }
  /** The expiry is not in the future: a grant that is over before it starts grants nothing. */
  | { readonly ok: false; readonly reason: "expired" }
  /** The object names a model, a reference table or a report the customer does not have. */
  | { readonly ok: false; readonly reason: "no-such-object"; readonly object: string }
  | NotHeld;

/**
 * Give a permission, or reading an object, to a role or a member, standing (`expiresAt` null) or
 * until `expiresAt`. The same grant stored already has its expiry moved; an identical one is
 * `unchanged`.
 */
export async function save(
  exec: SqlExecutor,
  input: NamedSubject &
    NamedGrant & {
      tenantId: string;
      expiresAt: string | null;
      held: Holding;
      now: Date;
      actor: Actor;
      actorId: string;
    },
): Promise<SaveOutcome> {
  const granted = grantedBy(input);
  if (!granted.ok) {
    return granted;
  }
  const over = beyondFor(input.held, granted.object);
  if (!within(over)) {
    return notHeld(over);
  }
  if (input.expiresAt !== null && new Date(input.expiresAt) <= input.now) {
    return { ok: false, reason: "expired" };
  }
  const resolved = await resolve(exec, input.tenantId, input);
  if (!resolved.ok) {
    return resolved;
  }
  if (granted.reach !== null && !(await exists(exec, input.tenantId, granted.reach))) {
    return { ok: false, reason: "no-such-object", object: granted.object };
  }
  const saved = await saveGrant(exec, {
    tenantId: input.tenantId,
    subject: resolved.subject,
    object: granted.object,
    action: granted.action,
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
        ...(input.permission === undefined
          ? { object: granted.object }
          : { permission: input.permission }),
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
  | NotHeld;

/** Take one grant away, unless it gives a permission the caller lacks or an object they do not reach. */
export async function remove(
  exec: SqlExecutor,
  input: { tenantId: string; id: string; held: Holding; actor: Actor },
): Promise<RemoveOutcome> {
  const found = await findGrant(exec, input.tenantId, input.id);
  if (found === null) {
    return { ok: false, reason: "not-found" };
  }
  const over = beyondFor(input.held, found.object);
  if (!within(over)) {
    return notHeld(over);
  }
  if (!(await deleteGrant(exec, input.tenantId, input.id, found.object))) {
    return { ok: false, reason: "not-found" };
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

export type ReachOutcome =
  | { readonly ok: true; readonly holding: Holding }
  | { readonly ok: false; readonly reason: SubjectRefusal };

/**
 * What a role confers or a member holds -- the permissions, and what they reach, as Casbin decides
 * them -- or, naming nobody, what the caller holds. The question to ask before a grant and after
 * it: "what can this person see now".
 */
export async function holdingFor(
  exec: SqlExecutor,
  input: NamedSubject & { tenantId: string; caller: Holding },
): Promise<ReachOutcome> {
  if (input.role === undefined && input.email === undefined) {
    return { ok: true, holding: input.caller };
  }
  if (input.role !== undefined && input.email !== undefined) {
    return { ok: false, reason: "one-subject" };
  }
  if (input.role !== undefined) {
    const holding = await conferredBy(exec, input.tenantId, input.role);
    return holding === null ? { ok: false, reason: "no-such-role" } : { ok: true, holding };
  }
  const holding = await heldByMember(exec, input.tenantId, input.email ?? "");
  return holding === null ? { ok: false, reason: "not-member" } : { ok: true, holding };
}

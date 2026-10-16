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
import type { RowRule } from "@undercroft/contracts/rowRules";
import type { SqlExecutor } from "@undercroft/db";
import {
  deleteGrant,
  findGrant,
  findSameGrant,
  type GrantRow,
  type GrantSubject,
  listGrants,
  saveGrant,
} from "../repos/accessGrants.ts";
import { type Actor, record as recordAudit } from "../repos/auditLog.ts";
import { type Beyond, type Holding, within } from "./authz.ts";
import {
  beyondFor,
  exists,
  type Granted,
  grantedBy,
  type NamedGrant,
  rulesStored,
  storedRules,
  unknownColumns,
} from "./grantObjects.ts";
import { type NamedSubject, resolve, type SubjectRefusal } from "./grantSubjects.ts";
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
  /** A model grant's row rule (ADR 0143): conditions a row meets, all of them; `null` for every row. */
  readonly rowRule: RowRule | null;
  /** A model grant's hidden columns; `null` for none. */
  readonly hiddenColumns: readonly string[] | null;
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
    rowRule: row.rowRule,
    hiddenColumns: row.hiddenColumns,
    expiresAt: row.expiresAt,
    expired: row.expired,
    grantedBy: row.grantedBy,
    createdAt: row.createdAt,
  };
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
  /**
   * Neither or both of a permission and an object; an object the grammar does not admit; a rule
   * on anything but one model (ADR 0143); an `eq` with other than one value.
   */
  | { readonly ok: false; readonly reason: SubjectRefusal | "one-object" | "unknown-object" }
  | { readonly ok: false; readonly reason: "rules-need-one-model" | "eq-one-value" }
  /** A rule names a column the model does not have, as its last build found it. */
  | {
      readonly ok: false;
      readonly reason: "unknown-column";
      readonly model: string;
      readonly unknown: readonly string[];
      readonly known: readonly string[];
    }
  /** The grant was changed or made by someone else between being weighed and being written. */
  | { readonly ok: false; readonly reason: "changed" }
  /** The expiry is not in the future: a grant that is over before it starts grants nothing. */
  | { readonly ok: false; readonly reason: "expired" }
  /** The object names a model, a reference table or a report the customer does not have. */
  | { readonly ok: false; readonly reason: "no-such-object"; readonly object: string }
  | NotHeld;

/** What `save` is asked: whom, what, until when, and who asks with what they hold. */
type SaveInput = NamedSubject &
  NamedGrant & {
    tenantId: string;
    expiresAt: string | null;
    held: Holding;
    now: Date;
    actor: Actor;
    actorId: string;
  };

/** A grant that passed every check, ready to write: what it gives, to whom, over which row. */
type Checked =
  | {
      readonly ok: true;
      readonly granted: Extract<Granted, { ok: true }>;
      readonly subject: GrantSubject;
      /** The same grant stored already, as it was weighed; `null` when there is none. */
      readonly judged: GrantRow | null;
    }
  | Exclude<SaveOutcome, { ok: true }>;

/**
 * Every refusal a grant can earn before it is written, in order: what it names, the subset rule,
 * the expiry, whom it is for, that the thing exists, that its rules name the model's columns
 * (ADR 0143) -- and, since saving it again replaces what it gave, the subset rule over the grant
 * it replaces, weighed as a removal is.
 */
async function checked(exec: SqlExecutor, input: SaveInput): Promise<Checked> {
  const granted = grantedBy(input);
  if (!granted.ok) {
    return granted;
  }
  const over = beyondFor(input.held, granted.object, granted.rules);
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
  const columns = await unknownColumns(exec, input.tenantId, granted);
  if (columns !== null) {
    return { ok: false, reason: "unknown-column", ...columns };
  }
  const judged = await findSameGrant(exec, {
    tenantId: input.tenantId,
    subject: resolved.subject,
    object: granted.object,
    action: granted.action,
  });
  const replaced =
    judged === null ? null : beyondFor(input.held, judged.object, rulesStored(judged));
  if (replaced !== null && !within(replaced)) {
    return notHeld(replaced);
  }
  return { ok: true, granted, subject: resolved.subject, judged };
}

/**
 * Give a permission, or reading an object, to a role or a member, standing (`expiresAt` null) or
 * until `expiresAt`. The same grant stored already has its expiry and rules replaced; an
 * identical one is `unchanged`.
 */
export async function save(exec: SqlExecutor, input: SaveInput): Promise<SaveOutcome> {
  const found = await checked(exec, input);
  if (!found.ok) {
    return found;
  }
  const { granted, subject, judged } = found;
  const stored = storedRules(granted.rules);
  const saved = await saveGrant(exec, {
    tenantId: input.tenantId,
    subject,
    object: granted.object,
    action: granted.action,
    expiresAt: input.expiresAt,
    rules: stored,
    grantedBy: input.actorId,
    judged,
  });
  if (saved === "changed") {
    return { ok: false, reason: "changed" };
  }
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
        before:
          judged === null
            ? null
            : {
                expiresAt: judged.expiresAt,
                rowRule: judged.rowRule,
                hiddenColumns: judged.hiddenColumns,
              },
        after: { expiresAt: input.expiresAt, ...stored },
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
  const over = beyondFor(input.held, found.object, rulesStored(found));
  if (!within(over)) {
    return notHeld(over);
  }
  if (!(await deleteGrant(exec, input.tenantId, found))) {
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
        rowRule: found.rowRule,
        hiddenColumns: found.hiddenColumns,
        expiresAt: found.expiresAt,
      },
      after: null,
    }),
  });
  return { ok: true };
}

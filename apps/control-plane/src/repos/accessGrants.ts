/**
 * `app.access_grant`: one permission given to a role or to one member, optionally until a moment
 * (ADR 0141, `600_custom_roles.sql`).
 *
 * Every statement is scoped by `tenant_id` as well as by id, so an administrator of one customer
 * cannot touch another's grant by guessing a uuid -- the arrangement `invitation.ts` keeps.
 *
 * Whether a grant has expired is decided here, in SQL, against the database's `now()`: the
 * projection reads the same clock in the same way (`membership.ts`), so the list and the gate
 * cannot disagree about whether a grant still holds. An expired grant is kept, as the record of
 * what somebody held and until when; saving it again moves its expiry.
 *
 * This module stores objects (`perm:models:write`, `model:fct_sales`) as the projection asks them
 * and knows nothing of the catalogue or the grammar: which permission or object one names is
 * `services/rbac.ts`'s and `@undercroft/contracts/access`'s to say.
 */

import type { RowRule } from "@undercroft/contracts/rowRules";
import type { SqlExecutor } from "@undercroft/db";

/** Who a grant is to: a role the customer has, by key, or a member, by user id. */
export type GrantSubject =
  | { readonly kind: "role"; readonly role: string }
  | { readonly kind: "user"; readonly userId: string };

export interface GrantRow {
  readonly id: string;
  readonly subjectKind: "role" | "user";
  /** The role's key for a grant to a role, else `null`. */
  readonly role: string | null;
  /** The member's address for a grant to a person, else `null`. */
  readonly email: string | null;
  readonly object: string;
  readonly action: string;
  /** A model grant's row rule (ADR 0143); `null` for every row. */
  readonly rowRule: RowRule | null;
  /** A model grant's hidden columns; `null` for none. */
  readonly hiddenColumns: readonly string[] | null;
  /** `null` for a grant that does not expire. */
  readonly expiresAt: string | null;
  /** Whether `expiresAt` has passed, by the database's clock: an expired grant holds nothing. */
  readonly expired: boolean;
  /** Who granted it, by address; `null` once that person is gone. */
  readonly grantedBy: string | null;
  readonly createdAt: string;
}

interface GrantRecord {
  id: string;
  subject_kind: "role" | "user";
  role_key: string | null;
  email: string | null;
  object: string;
  action: string;
  row_rule: RowRule | null;
  hidden_columns: string[] | null;
  expires_at: Date | string | null;
  expired: boolean;
  granted_by: string | null;
  created_at: Date | string;
}

const GRANT_SELECT = `
  SELECT g.id, g.subject_kind, g.role_key, member.email, g.object, g.action,
         g.row_rule, g.hidden_columns, g.expires_at,
         coalesce(g.expires_at <= now(), false) AS expired,
         granter.email AS granted_by, g.created_at
  FROM app.access_grant g
  LEFT JOIN app.app_user member ON member.id = g.user_id
  LEFT JOIN app.app_user granter ON granter.id = g.granted_by`;

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function toGrant(row: GrantRecord): GrantRow {
  return {
    id: row.id,
    subjectKind: row.subject_kind,
    role: row.role_key,
    email: row.email,
    object: row.object,
    action: row.action,
    rowRule: row.row_rule,
    hiddenColumns: row.hidden_columns,
    expiresAt: row.expires_at === null ? null : iso(row.expires_at),
    expired: row.expired,
    grantedBy: row.granted_by,
    createdAt: iso(row.created_at),
  };
}

/**
 * Every grant in the customer, expired ones included, standing grants first and then by the
 * moment each runs out; narrowed to one subject when one is named.
 */
export async function listGrants(
  exec: SqlExecutor,
  tenantId: string,
  subject: GrantSubject | null,
): Promise<GrantRow[]> {
  const { rows } = await exec.query<GrantRecord>(
    `${GRANT_SELECT}
     WHERE g.tenant_id = $1
       AND ($2::text IS NULL OR g.role_key = $2)
       AND ($3::uuid IS NULL OR g.user_id = $3)
     ORDER BY g.subject_kind, coalesce(g.role_key, member.email), g.object,
              g.expires_at NULLS FIRST`,
    [
      tenantId,
      subject?.kind === "role" ? subject.role : null,
      subject?.kind === "user" ? subject.userId : null,
    ],
  );
  return rows.map(toGrant);
}

/** One grant, or `null` when the customer has none with that id. */
export async function findGrant(
  exec: SqlExecutor,
  tenantId: string,
  id: string,
): Promise<GrantRow | null> {
  const { rows } = await exec.query<GrantRecord>(
    `${GRANT_SELECT} WHERE g.tenant_id = $1 AND g.id = $2`,
    [tenantId, id],
  );
  const [row] = rows;
  return row === undefined ? null : toGrant(row);
}

/** What saving a grant found and did. */
export interface GrantSaved {
  readonly id: string;
  /** Whether the same grant was stored already, and the expiry it had. */
  readonly existed: boolean;
  readonly previousExpiresAt: string | null;
  /** Whether anything was written: `false` when the stored grant was identical. */
  readonly written: boolean;
}

/** A model grant's rules as a column pair stores them: `null` for none of each (ADR 0143). */
export interface StoredRules {
  readonly rowRule: RowRule | null;
  readonly hiddenColumns: readonly string[] | null;
}

/** Who a grant is to, as the two subject columns hold it. */
function subjectColumns(subject: GrantSubject): { role: string | null; userId: string | null } {
  return {
    role: subject.kind === "role" ? subject.role : null,
    userId: subject.kind === "user" ? subject.userId : null,
  };
}

/** The grant stored for this subject, object and action (`access_grant_once`), or `null`. */
export async function findSameGrant(
  exec: SqlExecutor,
  input: { tenantId: string; subject: GrantSubject; object: string; action: string },
): Promise<GrantRow | null> {
  const { role, userId } = subjectColumns(input.subject);
  const { rows } = await exec.query<GrantRecord>(
    `${GRANT_SELECT}
     WHERE g.tenant_id = $1 AND g.subject_kind = $2
       AND g.role_key IS NOT DISTINCT FROM $3::text AND g.user_id IS NOT DISTINCT FROM $4::uuid
       AND g.object = $5 AND g.action = $6`,
    [input.tenantId, input.subject.kind, role, userId, input.object, input.action],
  );
  const [row] = rows;
  return row === undefined ? null : toGrant(row);
}

/**
 * Store a grant, or replace the one stored already for the same subject, object and action --
 * its expiry and, for a model grant, its rules (ADR 0143). An identical grant is written nowhere.
 *
 * `judged` is the grant as the caller was weighed against it: `null` when there was none, or the
 * row `findSameGrant` read. The write takes effect only if the row still is that -- an INSERT that
 * yields to one made meanwhile, an UPDATE guarded on the rules it replaces -- so the subset rule's
 * "you may take away only what you could have given" is held in the writing statement under the
 * row's lock, not read first and trusted after (ADR 0141). `"changed"` when it was not.
 */
export async function saveGrant(
  exec: SqlExecutor,
  input: {
    tenantId: string;
    subject: GrantSubject;
    object: string;
    action: string;
    expiresAt: string | null;
    rules: StoredRules;
    grantedBy: string;
    judged: GrantRow | null;
  },
): Promise<GrantSaved | "changed"> {
  const { role, userId } = subjectColumns(input.subject);
  const rowRule = input.rules.rowRule === null ? null : JSON.stringify(input.rules.rowRule);
  const hidden = input.rules.hiddenColumns === null ? null : [...input.rules.hiddenColumns];
  const { judged } = input;
  if (judged === null) {
    const { rows } = await exec.query<{ id: string }>(
      `INSERT INTO app.access_grant
         (tenant_id, subject_kind, role_key, user_id, object, action, expires_at,
          row_rule, hidden_columns, granted_by)
       VALUES ($1, $2, $3::text, $4::uuid, $5, $6, $7::timestamptz, $8::jsonb, $9::text[], $10)
       ON CONFLICT ON CONSTRAINT access_grant_once DO NOTHING
       RETURNING id`,
      [
        input.tenantId,
        input.subject.kind,
        role,
        userId,
        input.object,
        input.action,
        input.expiresAt,
        rowRule,
        hidden,
        input.grantedBy,
      ],
    );
    const id = rows[0]?.id;
    return id === undefined
      ? "changed"
      : { id, existed: false, previousExpiresAt: null, written: true };
  }
  const unchanged =
    sameInstant(judged.expiresAt, input.expiresAt) && rulesText(judged) === rulesText(input.rules);
  if (unchanged) {
    return { id: judged.id, existed: true, previousExpiresAt: judged.expiresAt, written: false };
  }
  const { rows } = await exec.query<{ id: string }>(
    `UPDATE app.access_grant
     SET expires_at = $3::timestamptz, row_rule = $4::jsonb, hidden_columns = $5::text[],
         granted_by = $6
     WHERE tenant_id = $1 AND id = $2
       AND row_rule IS NOT DISTINCT FROM $7::jsonb
       AND hidden_columns IS NOT DISTINCT FROM $8::text[]
     RETURNING id`,
    [
      input.tenantId,
      judged.id,
      input.expiresAt,
      rowRule,
      hidden,
      input.grantedBy,
      judged.rowRule === null ? null : JSON.stringify(judged.rowRule),
      judged.hiddenColumns === null ? null : [...judged.hiddenColumns],
    ],
  );
  return rows.length === 0
    ? "changed"
    : { id: judged.id, existed: true, previousExpiresAt: judged.expiresAt, written: true };
}

/**
 * A grant's rules as one text, in the order they were written: a stored row rule comes back from
 * `jsonb` with its keys in `jsonb`'s own order, so the two are compared field by field.
 */
function rulesText(rules: StoredRules): string {
  return JSON.stringify([
    rules.rowRule?.map((condition) => [condition.column, condition.op, condition.values]) ?? null,
    rules.hiddenColumns,
  ]);
}

/** Whether two instants, as stored or as asked for, are one: an ISO string or `null` each. */
function sameInstant(a: string | null, b: string | null): boolean {
  return a === null || b === null ? a === b : new Date(a).getTime() === new Date(b).getTime();
}

/**
 * Delete one grant, if it still grants what the caller was judged against -- its object and its
 * rules (the subset rule: you may take away only what you could have given). Nothing rewrites a
 * grant's object, and its rules change only through `saveGrant`, so the id, the object and the
 * rules together name exactly the grant that was weighed, and the statement that deletes it is the
 * one that checks. The answer is whether it went.
 */
export async function deleteGrant(
  exec: SqlExecutor,
  tenantId: string,
  judged: GrantRow,
): Promise<boolean> {
  const { rows } = await exec.query<{ id: string }>(
    `DELETE FROM app.access_grant
     WHERE tenant_id = $1 AND id = $2 AND object = $3
       AND row_rule IS NOT DISTINCT FROM $4::jsonb
       AND hidden_columns IS NOT DISTINCT FROM $5::text[]
     RETURNING id`,
    [
      tenantId,
      judged.id,
      judged.object,
      judged.rowRule === null ? null : JSON.stringify(judged.rowRule),
      judged.hiddenColumns === null ? null : [...judged.hiddenColumns],
    ],
  );
  return rows.length > 0;
}

/**
 * The columns of the model or reference table `name`, as its last successful build found them
 * (`app.model.columns`) or as it was declared (`app.seed.columns`): what a rule on it may name
 * (ADR 0143). `null` for a name the customer has neither of; empty for a model never built.
 */
export async function columnsOfModel(
  exec: SqlExecutor,
  tenantId: string,
  name: string,
): Promise<string[] | null> {
  const { rows } = await exec.query<{ columns: string[] | null }>(
    `SELECT coalesce(
       (SELECT array(SELECT jsonb_array_elements_text(m.columns))
        FROM app.model m WHERE m.tenant_id = $1 AND m.name = $2),
       (SELECT array(SELECT c ->> 'name' FROM jsonb_array_elements(s.columns) c)
        FROM app.seed s WHERE s.tenant_id = $1 AND s.name = $2)) AS columns`,
    [tenantId, name],
  );
  return rows[0]?.columns ?? null;
}

/**
 * Whether the customer has the model, reference table, question or dashboard an object grant
 * names (`model:<name>`, `report:<kind>:<id>`), by its parts: the name, or the kind and id.
 */
export async function objectExists(
  exec: SqlExecutor,
  tenantId: string,
  named:
    | { readonly model: string }
    | { readonly kind: "question" | "dashboard"; readonly id: string },
): Promise<boolean> {
  const { rows } = await exec.query<{ found: boolean }>(
    "model" in named
      ? `SELECT EXISTS (SELECT 1 FROM app.model WHERE tenant_id = $1 AND name = $2)
             OR EXISTS (SELECT 1 FROM app.seed WHERE tenant_id = $1 AND name = $2) AS found`
      : named.kind === "question"
        ? "SELECT EXISTS (SELECT 1 FROM app.bi_question WHERE tenant_id = $1 AND id = $2::uuid) AS found"
        : "SELECT EXISTS (SELECT 1 FROM app.bi_dashboard WHERE tenant_id = $1 AND id = $2::uuid) AS found",
    [tenantId, "model" in named ? named.model : named.id],
  );
  return rows[0]?.found === true;
}

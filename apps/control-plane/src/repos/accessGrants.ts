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
 * This module stores objects (`perm:models:write`) as the projection asks them and knows nothing
 * of the catalogue: which permission an object names is `services/rbac.ts`'s to say.
 */

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
  expires_at: Date | string | null;
  expired: boolean;
  granted_by: string | null;
  created_at: Date | string;
}

const GRANT_SELECT = `
  SELECT g.id, g.subject_kind, g.role_key, member.email, g.object, g.action, g.expires_at,
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

/**
 * Store a grant, or move the expiry of the same grant stored already -- one row per subject,
 * object and action (`access_grant_once`). An identical grant is written nowhere.
 *
 * `previous` reads the row as it stood before the statement: a data-modifying CTE does not see
 * its own writes, so the answer can say what the expiry was without a second round trip.
 */
export async function saveGrant(
  exec: SqlExecutor,
  input: {
    tenantId: string;
    subject: GrantSubject;
    object: string;
    action: string;
    expiresAt: string | null;
    grantedBy: string;
  },
): Promise<GrantSaved> {
  const role = input.subject.kind === "role" ? input.subject.role : null;
  const userId = input.subject.kind === "user" ? input.subject.userId : null;
  const { rows } = await exec.query<{
    id: string;
    existed: boolean;
    previous_expires_at: Date | string | null;
    written: boolean;
  }>(
    `WITH previous AS (
       SELECT id, expires_at FROM app.access_grant
       WHERE tenant_id = $1 AND subject_kind = $2
         AND role_key IS NOT DISTINCT FROM $3::text AND user_id IS NOT DISTINCT FROM $4::uuid
         AND object = $5 AND action = $6
     ),
     saved AS (
       INSERT INTO app.access_grant
         (tenant_id, subject_kind, role_key, user_id, object, action, expires_at, granted_by)
       VALUES ($1, $2, $3::text, $4::uuid, $5, $6, $7::timestamptz, $8)
       ON CONFLICT ON CONSTRAINT access_grant_once DO UPDATE
         SET expires_at = EXCLUDED.expires_at, granted_by = EXCLUDED.granted_by
         WHERE app.access_grant.expires_at IS DISTINCT FROM EXCLUDED.expires_at
       RETURNING id
     )
     SELECT coalesce((SELECT id FROM saved), (SELECT id FROM previous)) AS id,
            EXISTS (SELECT 1 FROM previous) AS existed,
            (SELECT expires_at FROM previous) AS previous_expires_at,
            EXISTS (SELECT 1 FROM saved) AS written`,
    [
      input.tenantId,
      input.subject.kind,
      role,
      userId,
      input.object,
      input.action,
      input.expiresAt,
      input.grantedBy,
    ],
  );
  const [row] = rows;
  if (row === undefined) {
    throw new Error("saving a grant answered no row; the statement always selects one");
  }
  return {
    id: row.id,
    existed: row.existed,
    previousExpiresAt: row.previous_expires_at === null ? null : iso(row.previous_expires_at),
    written: row.written,
  };
}

/**
 * Delete one grant, unless its object is one the caller lacks (`lacksObjects`, the subset rule:
 * you may take away only what you could have given). `found` is the grant as it stood, `null`
 * when the customer has none with that id; `done` whether it went.
 */
export async function deleteGrant(
  exec: SqlExecutor,
  tenantId: string,
  id: string,
  lacksObjects: readonly string[],
): Promise<{ readonly found: GrantRow | null; readonly done: boolean }> {
  const found = await findGrant(exec, tenantId, id);
  if (found === null) {
    return { found: null, done: false };
  }
  const { rows } = await exec.query<{ id: string }>(
    `DELETE FROM app.access_grant
     WHERE tenant_id = $1 AND id = $2 AND NOT (object = ANY ($3::text[]))
     RETURNING id`,
    [tenantId, id, [...lacksObjects]],
  );
  return { found, done: rows.length > 0 };
}

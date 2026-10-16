/**
 * `app.access_role`: the roles a person can hold in a customer -- the four built-ins and the
 * customer's own (ADR 0141, `600_custom_roles.sql`).
 *
 * A built-in is a row here too, with no permissions: its grants are code (`BUILT_IN_GRANTS`), and
 * the row exists so that one foreign key can refuse a membership or an invitation at a role the
 * customer does not have. The statements below never write a built-in row: `insertRole` cannot
 * (the CHECKs refuse a built-in key as a custom one), and `updateRole` and `deleteRole` carry
 * `NOT builtin` in their own WHERE.
 *
 * Two guards are written into the statements rather than read first and checked in a service,
 * for the reason `membership.ts` gives about the last admin: the check and the write must be one
 * step, or two concurrent requests each pass a check the other is about to make false.
 *
 * - **The subset rule** (ADR 0141): an edit or a delete names the permissions -- and, for a
 *   delete, the grant objects -- the CALLER LACKS, and the statement refuses to touch a role that
 *   holds any of them. What the caller holds is the service's to know; what the row holds at the
 *   moment of writing is this statement's, under the row lock.
 * - **A role in use is not deleted.** Held: the foreign key from `tenant_member` refuses it in
 *   any case, and the guard here only lets the refusal be worded with the counts. Invited: an
 *   OPEN invitation keeps the role, and a closed one goes with it (ON DELETE CASCADE).
 *
 * What a role confers is NOT decided here: `rolePolicy` reads the input to the projection and
 * Casbin decides (`services/rbac.ts`).
 */

import { BUILT_IN_ROLES } from "@undercroft/contracts/access";
import type { SqlExecutor } from "@undercroft/db";

/** One role as a customer has it, with how many hold it and how many are invited at it. */
export interface RoleRow {
  readonly key: string;
  readonly builtin: boolean;
  /** The customer's name for a role it defined; `null` for a built-in. */
  readonly label: string | null;
  readonly description: string;
  /** A custom role's permissions as stored; `null` for a built-in, whose grants are code. */
  readonly permissions: readonly string[] | null;
  readonly members: number;
  /** Open invitations at the role: neither accepted nor expired. */
  readonly invitations: number;
  readonly updatedAt: string;
  /** The address of whoever last saved it; `null` for a built-in, or someone since removed. */
  readonly updatedBy: string | null;
}

interface RoleRecord {
  key: string;
  builtin: boolean;
  label: string | null;
  description: string;
  permissions: string[] | null;
  members: number;
  invitations: number;
  updated_at: Date | string;
  updated_by: string | null;
}

const ROLE_SELECT = `
  SELECT r.key, r.builtin, r.label, r.description, r.permissions, r.updated_at,
         u.email AS updated_by,
         (SELECT count(*)::int FROM app.tenant_member m
          WHERE m.tenant_id = r.tenant_id AND m.role = r.key) AS members,
         (SELECT count(*)::int FROM app.invitation i
          WHERE i.tenant_id = r.tenant_id AND i.role = r.key
            AND i.accepted_at IS NULL AND i.expires_at > now()) AS invitations
  FROM app.access_role r
  LEFT JOIN app.app_user u ON u.id = r.updated_by`;

/** Built-ins first, in `BUILT_IN_ROLES` order -- passed as `$2`, not restated here -- then by key. */
const ROLE_ORDER = "ORDER BY r.builtin DESC, array_position($2::text[], r.key), r.key";

function toRole(row: RoleRecord): RoleRow {
  return {
    key: row.key,
    builtin: row.builtin,
    label: row.label,
    description: row.description,
    permissions: row.permissions,
    members: row.members,
    invitations: row.invitations,
    updatedAt: new Date(row.updated_at).toISOString(),
    updatedBy: row.updated_by,
  };
}

/** Every role the customer has. */
export async function listRoles(exec: SqlExecutor, tenantId: string): Promise<RoleRow[]> {
  const { rows } = await exec.query<RoleRecord>(
    `${ROLE_SELECT} WHERE r.tenant_id = $1 ${ROLE_ORDER}`,
    [tenantId, [...BUILT_IN_ROLES]],
  );
  return rows.map(toRole);
}

/** One role, or `null` when the customer has none with that key. */
export async function findRole(
  exec: SqlExecutor,
  tenantId: string,
  key: string,
): Promise<RoleRow | null> {
  const { rows } = await exec.query<RoleRecord>(
    `${ROLE_SELECT} WHERE r.tenant_id = $1 AND r.key = $2`,
    [tenantId, key],
  );
  const [row] = rows;
  return row === undefined ? null : toRole(row);
}

/** What the projection needs to say what holding a role confers, without a person. */
export interface RolePolicyRow {
  /** A custom role's stored permissions; empty for a built-in. */
  readonly rolePermissions: readonly string[];
  /** The grants in force to the role, every one `toRole`. */
  readonly grants: readonly { toRole: true; object: string; action: string }[];
}

/**
 * The role's policy in this tenant, or `null` when the customer has no such role. One statement,
 * the grants folded in the way `membership.ts` folds them, and unexpired by the same `now()`.
 */
export async function rolePolicy(
  exec: SqlExecutor,
  tenantId: string,
  key: string,
): Promise<RolePolicyRow | null> {
  const { rows } = await exec.query<{
    role_permissions: string[];
    grants: { toRole: true; object: string; action: string }[];
  }>(
    `SELECT coalesce(r.permissions, '{}') AS role_permissions,
            coalesce(
              (SELECT json_agg(json_build_object(
                        'toRole', true, 'object', g.object, 'action', g.action) ORDER BY g.object)
               FROM app.access_grant g
               WHERE g.tenant_id = r.tenant_id AND g.role_key = r.key
                 AND (g.expires_at IS NULL OR g.expires_at > now())),
              '[]'::json) AS grants
     FROM app.access_role r WHERE r.tenant_id = $1 AND r.key = $2`,
    [tenantId, key],
  );
  const [row] = rows;
  return row === undefined ? null : { rolePermissions: row.role_permissions, grants: row.grants };
}

/** A custom role as written: what `insertRole` and `updateRole` store. */
export interface RoleContent {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly permissions: readonly string[];
  /** The app_user uuid of the person saving it. */
  readonly updatedBy: string;
}

/** Create a custom role. `false` when the customer already has a role with that key. */
export async function insertRole(
  exec: SqlExecutor,
  tenantId: string,
  role: RoleContent,
): Promise<boolean> {
  const { rows } = await exec.query<{ key: string }>(
    `INSERT INTO app.access_role (tenant_id, key, label, description, permissions, updated_by)
     VALUES ($1, $2, $3, $4, $5::text[], $6)
     ON CONFLICT (tenant_id, key) DO NOTHING RETURNING key`,
    [tenantId, role.key, role.label, role.description, [...role.permissions], role.updatedBy],
  );
  return rows.length > 0;
}

/** A role as it stood when a guarded statement found it, before it wrote anything. */
export interface StoredRole {
  readonly builtin: boolean;
  readonly label: string | null;
  readonly description: string;
  readonly permissions: readonly string[] | null;
}

/**
 * What a guarded edit found and did. `found` is the role as it stood, `null` when there is none;
 * `done` whether it was changed. Found and not done is a refusal or an edit identical to what is
 * stored -- the caller tells them apart from `found`, which is why it is returned whole.
 */
export interface RoleEdit {
  readonly found: StoredRole | null;
  readonly done: boolean;
}

/**
 * Replace a custom role's label, description and permissions -- unless it is a built-in, it holds
 * a permission in `lacks` (the subset rule: the caller may not take away what they could not
 * give), or the content is what is stored already.
 *
 * `current` locks the row `FOR UPDATE` before the guard reads it, so a concurrent edit is waited
 * for and the permissions guarded are the ones being replaced, not a snapshot of them.
 */
export async function updateRole(
  exec: SqlExecutor,
  tenantId: string,
  role: RoleContent,
  lacks: readonly string[],
): Promise<RoleEdit> {
  const { rows } = await exec.query<StoredRow & { done: boolean }>(
    `WITH current AS MATERIALIZED (
       SELECT key, builtin, label, description, permissions FROM app.access_role
       WHERE tenant_id = $1 AND key = $2
       FOR UPDATE
     ),
     changed AS (
       UPDATE app.access_role r
       SET label = $3, description = $4, permissions = $5::text[], updated_by = $6,
           updated_at = now()
       FROM current c
       WHERE r.tenant_id = $1 AND r.key = c.key AND NOT c.builtin
         AND NOT (c.permissions && $7::text[])
         AND (c.label, c.description, c.permissions)
             IS DISTINCT FROM ($3::text, $4::text, $5::text[])
       RETURNING r.key
     )
     SELECT c.builtin, c.label, c.description, c.permissions,
            EXISTS (SELECT 1 FROM changed) AS done
     FROM current c`,
    [
      tenantId,
      role.key,
      role.label,
      role.description,
      [...role.permissions],
      role.updatedBy,
      [...lacks],
    ],
  );
  const [row] = rows;
  return row === undefined
    ? { found: null, done: false }
    : { found: toStored(row), done: row.done };
}

interface StoredRow {
  builtin: boolean;
  label: string | null;
  description: string;
  permissions: string[] | null;
}

function toStored(row: StoredRow): StoredRole {
  return {
    builtin: row.builtin,
    label: row.label,
    description: row.description,
    permissions: row.permissions,
  };
}

/** A role as its delete found it: itself, who holds it, who is invited, what is granted to it. */
export interface RoleInUse extends StoredRole {
  readonly members: number;
  readonly invitations: number;
  /** The objects of every grant to the role, expired or not: they go with it. */
  readonly grantObjects: readonly string[];
}

/**
 * Delete a custom role, unless it is a built-in, somebody holds it, an open invitation names it,
 * or it -- or a grant to it, which the delete takes too -- holds a permission the caller lacks:
 * `lacks` as role permissions, `lacksObjects` as grant objects.
 *
 * The row is locked first, as in `updateRole`. A membership written at this role after the lock
 * is refused by its foreign key once the delete commits; one written before is counted here.
 */
export async function deleteRole(
  exec: SqlExecutor,
  tenantId: string,
  key: string,
  lacks: { readonly permissions: readonly string[]; readonly objects: readonly string[] },
): Promise<{ readonly found: RoleInUse | null; readonly done: boolean }> {
  const { rows } = await exec.query<
    StoredRow & { members: number; invitations: number; grant_objects: string[]; done: boolean }
  >(
    `WITH target AS MATERIALIZED (
       SELECT key, builtin, label, description, permissions FROM app.access_role
       WHERE tenant_id = $1 AND key = $2
       FOR UPDATE
     ),
     uses AS MATERIALIZED (
       SELECT
         (SELECT count(*)::int FROM app.tenant_member WHERE tenant_id = $1 AND role = $2)
           AS members,
         (SELECT count(*)::int FROM app.invitation
          WHERE tenant_id = $1 AND role = $2 AND accepted_at IS NULL AND expires_at > now())
           AS invitations,
         coalesce(
           (SELECT array_agg(object ORDER BY object) FROM app.access_grant
            WHERE tenant_id = $1 AND role_key = $2),
           '{}') AS grant_objects
     ),
     removed AS (
       DELETE FROM app.access_role r
       USING target t, uses u
       WHERE r.tenant_id = $1 AND r.key = t.key AND NOT t.builtin
         AND u.members = 0 AND u.invitations = 0
         AND NOT (t.permissions && $3::text[])
         AND NOT (u.grant_objects && $4::text[])
       RETURNING r.key
     )
     SELECT t.builtin, t.label, t.description, t.permissions,
            u.members, u.invitations, u.grant_objects,
            EXISTS (SELECT 1 FROM removed) AS done
     FROM target t, uses u`,
    [tenantId, key, [...lacks.permissions], [...lacks.objects]],
  );
  const [row] = rows;
  return row === undefined
    ? { found: null, done: false }
    : {
        found: {
          ...toStored(row),
          members: row.members,
          invitations: row.invitations,
          grantObjects: row.grant_objects,
        },
        done: row.done,
      };
}

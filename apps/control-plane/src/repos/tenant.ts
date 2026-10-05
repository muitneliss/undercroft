/**
 * `ops.tenant`: the customer record, with no secret material in it.
 *
 * Two writers, and since ADR 0013 one of them IS reachable over HTTP. `ensureTenant` is the
 * bootstrap CLI's (`bun run invite`), which has to be able to create the first tenant when
 * nobody is signed in; `createTenant` is the superadmin-only `tenants.create` procedure's.
 *
 * They differ only in what they report, and that difference is why there are two of them:
 * the CLI is idempotent by design -- re-running the bootstrap command must not fail -- while
 * a person typing a reference into a form has to be TOLD it is already taken, or they will
 * believe they created a customer they in fact merely named.
 *
 * "A tenant is not created by a request" held until ADR 0013 and no longer does. What
 * replaces it is narrower and enforced one layer up: only a platform superadmin may create
 * one, and no tenant-scoped role can, however senior.
 *
 * Whether a customer is deactivated (ADR 0110) is one nullable column, `deactivated_at`, and
 * this repo is its only writer: `deactivateTenant` and `reactivateTenant`, each a conditional
 * UPDATE that changes the row only when it is in the other state.
 */

import type { SqlExecutor } from "@undercroft/db";

export interface Tenant {
  readonly id: string;
  readonly displayName: string;
  /** When an admin deactivated it, as an ISO instant; `null` while it is in use. ADR 0110. */
  readonly deactivatedAt: string | null;
}

/** The row as Postgres returns it: `pg` answers a timestamptz as a Date, PGlite as either. */
export interface TenantRow {
  readonly id: string;
  readonly display_name: string;
  readonly deactivated_at: Date | string | null;
}

/** The columns every read below selects, in the shape `toTenant` reads. */
const TENANT_COLUMNS = "id, display_name, deactivated_at";

/** The column as the ISO instant every caller reads, or `null` for a tenant in use. */
export function deactivatedAtOf(row: Pick<TenantRow, "deactivated_at">): string | null {
  return row.deactivated_at === null ? null : new Date(row.deactivated_at).toISOString();
}

export function toTenant(row: TenantRow): Tenant {
  return { id: row.id, displayName: row.display_name, deactivatedAt: deactivatedAtOf(row) };
}

/** One tenant, or `null`. Whether "absent" is a 404 is the caller's decision. */
export async function findTenant(exec: SqlExecutor, tenantId: string): Promise<Tenant | null> {
  const { rows } = await exec.query<TenantRow>(
    `SELECT ${TENANT_COLUMNS} FROM ops.tenant WHERE id = $1`,
    [tenantId],
  );
  const [row] = rows;
  return row === undefined ? null : toTenant(row);
}

/**
 * Create the tenant if it is not there. Idempotent, and never renames an existing one.
 *
 * `DO NOTHING` rather than `DO UPDATE`: running the bootstrap command twice must not
 * silently retitle a tenant that is already in use.
 */
export async function ensureTenant(
  exec: SqlExecutor,
  tenantId: string,
  displayName: string,
): Promise<void> {
  await exec.query(
    "INSERT INTO ops.tenant (id, display_name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
    [tenantId, displayName],
  );
}

/**
 * Create the tenant, reporting whether this call is what created it.
 *
 * `DO NOTHING ... RETURNING id` yields a row only on the insert, which is the whole point:
 * `false` means the reference was already in use and the caller must say so rather than
 * report a success that renamed nothing. Never `DO UPDATE` -- an operator who mistypes an
 * existing reference must not retitle a live customer as a side effect of being told "no".
 */
export async function createTenant(
  exec: SqlExecutor,
  tenantId: string,
  displayName: string,
): Promise<boolean> {
  const { rows } = await exec.query<{ id: string }>(
    `INSERT INTO ops.tenant (id, display_name) VALUES ($1, $2)
     ON CONFLICT (id) DO NOTHING RETURNING id`,
    [tenantId, displayName],
  );
  return rows.length > 0;
}

/**
 * Remove a tenant row that was created moments ago and cannot be kept.
 *
 * One caller: `services/tenants.create`, undoing its own insert when the roles for the new
 * id cannot be provisioned. There is no other deletion path in the product -- a customer
 * with data is never removed by a request -- and the name says so: this is not `deleteTenant`.
 */
export async function undoCreateTenant(exec: SqlExecutor, tenantId: string): Promise<void> {
  await exec.query("DELETE FROM ops.tenant WHERE id = $1", [tenantId]);
}

/**
 * Change a tenant's display name. The id is never touched.
 *
 * The `SET` list names one column deliberately. `ops.tenant.id` becomes an S3 key prefix in
 * the raw lake, and the lake is create-only -- an object already written under
 * `records/{source}/{id}/...` cannot be moved, so changing the id here would strand every
 * byte already landed under the old one while new data went somewhere else. The display name
 * has no such reach: it lives in this column and nowhere else.
 *
 * Returns the updated row, or `null` when no tenant has that id. `RETURNING` rather than a
 * rowcount because the caller reports the new name back to a form, and reading it from the
 * database is what makes the answer the truth rather than an echo of the request.
 */
export async function renameTenant(
  exec: SqlExecutor,
  tenantId: string,
  displayName: string,
): Promise<Tenant | null> {
  const { rows } = await exec.query<TenantRow>(
    `UPDATE ops.tenant SET display_name = $2 WHERE id = $1
     RETURNING ${TENANT_COLUMNS}`,
    [tenantId, displayName],
  );
  const [row] = rows;
  return row === undefined ? null : toTenant(row);
}

/**
 * Deactivate a tenant, if it is in use. Returns the row as it now stands, or `null` when no
 * tenant with that id is in use -- absent, or deactivated already.
 *
 * The state is the statement's condition, not a read before it, so two admins pressing
 * Deactivate at once produce one transition and one `null`: the first moment is the one kept,
 * and the second caller is told rather than allowed to overwrite when it happened.
 */
export async function deactivateTenant(
  exec: SqlExecutor,
  tenantId: string,
): Promise<Tenant | null> {
  const { rows } = await exec.query<TenantRow>(
    `UPDATE ops.tenant SET deactivated_at = now()
     WHERE id = $1 AND deactivated_at IS NULL
     RETURNING ${TENANT_COLUMNS}`,
    [tenantId],
  );
  const [row] = rows;
  return row === undefined ? null : toTenant(row);
}

/** Reactivate a tenant, if it is deactivated. `null` when no deactivated tenant has that id. */
export async function reactivateTenant(
  exec: SqlExecutor,
  tenantId: string,
): Promise<Tenant | null> {
  const { rows } = await exec.query<TenantRow>(
    `UPDATE ops.tenant SET deactivated_at = NULL
     WHERE id = $1 AND deactivated_at IS NOT NULL
     RETURNING ${TENANT_COLUMNS}`,
    [tenantId],
  );
  const [row] = rows;
  return row === undefined ? null : toTenant(row);
}

/**
 * Every tenant on the platform.
 *
 * The counterpart to `membership.listForUser`, and the ONLY query in the control plane that
 * ignores membership. It is reachable from exactly one caller -- `tenants.listForCaller`,
 * for a superadmin -- and it is written here rather than as a flag on `listForUser` so that
 * the query which IS the visibility boundary stays a query with no way to widen it.
 */
export async function listAllTenants(exec: SqlExecutor): Promise<Tenant[]> {
  const { rows } = await exec.query<TenantRow>(
    `SELECT ${TENANT_COLUMNS} FROM ops.tenant ORDER BY id`,
  );
  return rows.map(toTenant);
}

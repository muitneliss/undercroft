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
 */

// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useDestructuring: Style preference with no correctness content, and it fires where the current form names the source of the value (`params.tenantId`), which is the thing worth seeing at the call site.

// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys (Invoices, InvoiceID), HTTP header names, and Better Auth's option keys (baseURL, storeOTP) and table names (auth_user). strictCase cannot be satisfied by code that talks to another system.

import type { SqlExecutor } from "@undercroft/db";

export interface Tenant {
  readonly id: string;
  readonly displayName: string;
}

/** One tenant, or `null`. Whether "absent" is a 404 is the caller's decision. */
export async function findTenant(exec: SqlExecutor, tenantId: string): Promise<Tenant | null> {
  const { rows } = await exec.query<{ id: string; display_name: string }>(
    "SELECT id, display_name FROM ops.tenant WHERE id = $1",
    [tenantId],
  );
  const row = rows[0];
  return row === undefined ? null : { id: row.id, displayName: row.display_name };
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
  const { rows } = await exec.query<{ id: string; display_name: string }>(
    `UPDATE ops.tenant SET display_name = $2 WHERE id = $1
     RETURNING id, display_name`,
    [tenantId, displayName],
  );
  const row = rows[0];
  return row === undefined ? null : { id: row.id, displayName: row.display_name };
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
  const { rows } = await exec.query<{ id: string; display_name: string }>(
    "SELECT id, display_name FROM ops.tenant ORDER BY id",
  );
  return rows.map((row) => ({ id: row.id, displayName: row.display_name }));
}

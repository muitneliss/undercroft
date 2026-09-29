/**
 * `ops.tenant_role`: which Postgres logins belong to which customer.
 *
 * The two SQL functions behind `provisionTenantRoles` and `rotateTenantPassword` are the
 * only code that creates a role, a schema or a default privilege, and they are the only
 * code that ever sees a tenant role's password in the clear. `extendTenantPassword` changes
 * only when that password expires. This repo does nothing but call them and read the
 * mapping; the reasoning is in `080_tenant_isolation.sql`, ADR 0018 and ADR 0087.
 *
 * Both apps import this from `@undercroft/db/repos`: the control plane provisions when a
 * tenant is created, the worker rotates or extends before a build or a query session.
 * Neither holds a private copy of the SQL.
 */

import type { SqlExecutor } from "../executor.ts";

export type TenantRoleKind = "dbt" | "bi";

export interface TenantRoles {
  readonly slug: string;
  readonly dbtRole: string;
  readonly biRole: string;
  readonly analyticsSchema: string;
  readonly dqSchema: string;
}

/**
 * Create the tenant's two roles and two schemas, or confirm they exist.
 *
 * Raises on a collision: two tenant ids that fold to one slug would share a login, and
 * the function refuses before any role exists. `isRoleCollision` recognises that refusal
 * so a caller can name it rather than report a server fault.
 */
export async function provisionTenantRoles(exec: SqlExecutor, tenantId: string): Promise<void> {
  await exec.query("SELECT ops.provision_tenant($1)", [tenantId]);
}

/** Whether a provisioning failure was the slug collision the function refuses. */
export function isRoleCollision(error: unknown): boolean {
  return error instanceof Error && error.message.includes("already belongs to another tenant");
}

/**
 * Set a fresh password on one of the tenant's roles, good for `validForMs`, and return it.
 *
 * A role has one password, so this refuses every login still to be made with the previous
 * one. The plaintext exists only in the worker's memory while a build or session of that
 * login runs (ADR 0087); nothing stores it.
 */
export async function rotateTenantPassword(
  exec: SqlExecutor,
  tenantId: string,
  kind: TenantRoleKind,
  validForMs: number,
): Promise<string> {
  const { rows } = await exec.query<{ password: string }>(
    "SELECT ops.rotate_tenant_password($1, $2, $3::interval) AS password",
    [tenantId, kind, `${String(validForMs)} milliseconds`],
  );
  const password = rows[0]?.password;
  if (password === undefined || password === "") {
    throw new Error(`undercroft: no password was minted for ${tenantId}/${kind}`);
  }
  return password;
}

/**
 * Keep the role's current password valid for at least `validForMs` more, without changing
 * it. Never shortens: a later expiry already set stays.
 */
export async function extendTenantPassword(
  exec: SqlExecutor,
  tenantId: string,
  kind: TenantRoleKind,
  validForMs: number,
): Promise<void> {
  await exec.query("SELECT ops.extend_tenant_password($1, $2, $3::interval)", [
    tenantId,
    kind,
    `${String(validForMs)} milliseconds`,
  ]);
}

/** The tenant's roles and schemas, or `null` for a tenant never provisioned. */
export async function tenantRolesFor(
  exec: SqlExecutor,
  tenantId: string,
): Promise<TenantRoles | null> {
  const { rows } = await exec.query<{ kind: TenantRoleKind; role_name: string; slug: string }>(
    "SELECT kind, role_name, slug FROM ops.tenant_role WHERE tenant_id = $1",
    [tenantId],
  );
  const dbt = rows.find((r) => r.kind === "dbt");
  const bi = rows.find((r) => r.kind === "bi");
  if (dbt === undefined || bi === undefined) {
    return null;
  }
  return {
    slug: dbt.slug,
    dbtRole: dbt.role_name,
    biRole: bi.role_name,
    analyticsSchema: `analytics_${dbt.slug}`,
    dqSchema: `dq_${dbt.slug}`,
  };
}

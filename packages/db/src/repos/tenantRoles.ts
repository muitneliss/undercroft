/**
 * `ops.tenant_role`: which Postgres logins belong to which customer.
 *
 * The two SQL functions behind `provisionTenantRoles` and `rotateTenantPassword` are the
 * only code that creates a role, a schema or a default privilege, and they are the only
 * code that ever sees a tenant role's password in the clear. This repo does nothing but
 * call them and read the mapping; the reasoning is in `080_tenant_isolation.sql` and ADR
 * 0018.
 *
 * Both apps import this from `@undercroft/db/repos`: the control plane provisions when a
 * tenant is created, the worker rotates before a build or a query session. Neither holds
 * a private copy of the SQL.
 */

// biome-ignore-all lint/style/useExportsLast: Reordering modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. That ordering carries meaning; the rule's preferred one does not.
// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys, HTTP header names, and Better Auth's option keys and table names. strictCase cannot be satisfied by code that talks to another system.

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
 * Set a fresh, time-limited password on one of the tenant's roles and return it.
 *
 * The plaintext exists in the caller's memory for the one build or session it was minted
 * for. Nothing stores it; the next need mints another.
 */
export async function rotateTenantPassword(
  exec: SqlExecutor,
  tenantId: string,
  kind: TenantRoleKind,
): Promise<string> {
  const { rows } = await exec.query<{ password: string }>(
    "SELECT ops.rotate_tenant_password($1, $2) AS password",
    [tenantId, kind],
  );
  const password = rows[0]?.password;
  if (password === undefined || password === "") {
    throw new Error(`undercroft: no password was minted for ${tenantId}/${kind}`);
  }
  return password;
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

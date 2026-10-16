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
 * tenant is created, the worker rotates or extends before a build or a query session, and
 * provisions a scope login before the first session of a reader who reaches only some models
 * (ADR 0142). Neither holds a private copy of the SQL.
 */

import type { SqlExecutor } from "../executor.ts";

export type TenantRoleKind = "dbt" | "bi";

/**
 * Which of a customer's logins a password is for: its dbt or BI login, or one of its scope
 * logins by name (ADR 0142, `620_scope_logins.sql`), which `provisionScope` answers with.
 */
export type TenantLogin =
  | { readonly kind: TenantRoleKind }
  | { readonly kind: "scope"; readonly login: string };

export interface TenantRoles {
  readonly slug: string;
  readonly dbtRole: string;
  readonly biRole: string;
  /** What the BI login reads: only what passed its tests is here (ADR 0131). */
  readonly analyticsSchema: string;
  readonly dqSchema: string;
  /** Where a build writes, before its tests decide what is promoted. BI has no USAGE on it. */
  readonly stagingSchema: string;
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
  login: TenantRoleKind | TenantLogin,
  validForMs: number,
): Promise<string> {
  const { kind, name } = loginOf(login);
  const { rows } = await exec.query<{ password: string }>(
    "SELECT ops.rotate_tenant_password($1, $2, $3::interval, $4::name) AS password",
    [tenantId, kind, `${String(validForMs)} milliseconds`, name],
  );
  const password = rows[0]?.password;
  if (password === undefined || password === "") {
    throw new Error(`undercroft: no password was minted for ${tenantId}/${kind}`);
  }
  return password;
}

/** A login as the two password functions take it: its kind, and a scope login's name. */
function loginOf(login: TenantRoleKind | TenantLogin): { kind: string; name: string | null } {
  if (typeof login === "string") {
    return { kind: login, name: null };
  }
  return login.kind === "scope"
    ? { kind: "scope", name: login.login }
    : { kind: login.kind, name: null };
}

/**
 * How much of one model a scope reads (ADR 0143), as `ops.provision_scope` takes it: the rows
 * meeting any one rule (`null`, every row), and every column but the hidden ones. The shape is
 * `ModelLimit` in `@undercroft/contracts/access`, restated here because this package sits below it.
 */
export interface ScopeLimitInput {
  readonly model: string;
  readonly rows:
    | readonly (readonly {
        readonly column: string;
        readonly op: string;
        readonly values: readonly string[];
      }[])[]
    | null;
  readonly hidden: readonly string[];
}

/**
 * The scope login that reads exactly `models` of the customer's analytics, as much of each as
 * `limits` says, made and granted the first time anyone needs it, and marked as in use every time
 * (ADR 0142, ADR 0143). The models are names; their order and repeats do not matter, and nor does
 * the order of the rules, because `ops.provision_scope` hashes the set in one canonical form.
 * Raises for a tenant never provisioned, for a name that is not a model's, and for a rule that is
 * not one.
 */
export async function provisionScope(
  exec: SqlExecutor,
  tenantId: string,
  models: readonly string[],
  limits: readonly ScopeLimitInput[] = [],
): Promise<string> {
  const { rows } = await exec.query<{ login: string }>(
    "SELECT ops.provision_scope($1, $2::text[], $3::jsonb) AS login",
    [tenantId, [...models], JSON.stringify(limits)],
  );
  const login = rows[0]?.login;
  if (login === undefined) {
    throw new Error(`undercroft: no scope login was provisioned for ${tenantId}`);
  }
  return login;
}

/**
 * Keep the role's current password valid for at least `validForMs` more, without changing
 * it. Never shortens: a later expiry already set stays.
 */
export async function extendTenantPassword(
  exec: SqlExecutor,
  tenantId: string,
  login: TenantRoleKind | TenantLogin,
  validForMs: number,
): Promise<void> {
  const { kind, name } = loginOf(login);
  await exec.query("SELECT ops.extend_tenant_password($1, $2, $3::interval, $4::name)", [
    tenantId,
    kind,
    `${String(validForMs)} milliseconds`,
    name,
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
    stagingSchema: `staging_${dbt.slug}`,
  };
}

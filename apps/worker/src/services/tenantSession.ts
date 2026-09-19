/**
 * Running SQL as a tenant: the seam that turns "which login" into a decision Postgres makes.
 *
 * A tenant's models are built by its own dbt login and its rows are read by its own BI
 * login (ADR 0018); the row-level policy on `raw` and the grants on `analytics_<slug>` are
 * keyed on that login, so the only thing the worker has to get right is to BE it. This
 * module is where it does: mint a password for the role, open a pool as it, run the work,
 * end the pool. The password lives in this function's frame and nowhere else.
 *
 * `sessionsBySetRole` is the same seam over PGlite, where there is no authentication and
 * `SET ROLE` is how a test steps into a tenant. It proves the grants; the login is proven
 * against real Postgres in the Docker tier.
 */

// biome-ignore-all lint/nursery/useExplicitReturnType: Same set as useExplicitType above: what remains are contextually-typed callbacks and factories whose inferred type is a tRPC router shape hundreds of characters wide.
// biome-ignore-all lint/nursery/useExplicitType: Every site whose type the compiler could print is annotated. What is left is parameters of callbacks passed to third-party APIs -- Better Auth's hooks, tRPC's builders -- where the type arrives contextually and writing it out means naming a library-internal type that drifts on the next upgrade.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useExportsLast: Reordering modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. That ordering carries meaning; the rule's preferred one does not.

import { asExecutor, createRolePool, type SqlExecutor } from "@undercroft/db";
import { rotateTenantPassword, type TenantRoleKind, tenantRolesFor } from "@undercroft/db/repos";

export interface SessionTarget {
  readonly tenantId: string;
  readonly kind: TenantRoleKind;
}

export interface TenantSessions {
  /** Run `fn` on an executor that is the tenant's `kind` login. */
  readonly as: <T>(target: SessionTarget, fn: (exec: SqlExecutor) => Promise<T>) => Promise<T>;
}

export class TenantNotProvisioned extends Error {
  constructor(tenantId: string) {
    super(`tenant ${tenantId} has no roles; provision it first`);
    this.name = "TenantNotProvisioned";
  }
}

function roleFor(roles: { dbtRole: string; biRole: string }, kind: TenantRoleKind): string {
  return kind === "bi" ? roles.biRole : roles.dbtRole;
}

/** The production seam: a fresh password, one pool as the role, ended when `fn` settles. */
export function createTenantSessions(deps: {
  readonly exec: SqlExecutor;
  readonly dsn: string;
}): TenantSessions {
  return {
    async as(target, fn) {
      const roles = await tenantRolesFor(deps.exec, target.tenantId);
      if (roles === null) {
        throw new TenantNotProvisioned(target.tenantId);
      }
      const password = await rotateTenantPassword(deps.exec, target.tenantId, target.kind);
      const pool = createRolePool(deps.dsn, { user: roleFor(roles, target.kind), password });
      try {
        return await fn(asExecutor(pool));
      } finally {
        await pool.end();
      }
    },
  };
}

/**
 * The same seam over a single superuser connection that can `SET ROLE`: PGlite in the gate.
 * `asRole` is `TestDatabase.asRole`; the mapping still comes from `ops.tenant_role`, so a
 * tenant that was never provisioned is refused here exactly as in production.
 */
export function sessionsBySetRole(
  exec: SqlExecutor,
  asRole: <T>(role: string, fn: (tx: SqlExecutor) => Promise<T>) => Promise<T>,
): TenantSessions {
  return {
    async as(target, fn) {
      const roles = await tenantRolesFor(exec, target.tenantId);
      if (roles === null) {
        throw new TenantNotProvisioned(target.tenantId);
      }
      return asRole(roleFor(roles, target.kind), fn);
    },
  };
}

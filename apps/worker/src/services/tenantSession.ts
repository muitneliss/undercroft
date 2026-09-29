/**
 * Running SQL as a tenant: the seam that turns "which login" into a decision Postgres makes.
 *
 * A tenant's models are built by its own dbt login and its rows are read by its own BI
 * login (ADR 0018); the row-level policy on `raw` and the grants on `analytics_<slug>` are
 * keyed on that login, so the only thing the worker has to get right is to BE it. This
 * module is where it does: hold a password for the role, open a pool as it (or hand it to
 * dbt), run the work, let go. The password lives in this module's memory and nowhere else.
 *
 * WHY A LEASE AND NOT A ROTATION PER SESSION (ADR 0087). A Postgres role has ONE password.
 * Minting a fresh one for every session refused every other session of the same login that
 * had yet to authenticate: a raw-lake query opened while `dbt build` was parsing changed the
 * password under it, and the build failed on its first connection, before any model -- a
 * whole tenant's build, broken by a read. So the first holder of a login rotates, as before;
 * every holder that overlaps it shares that password; and the next rotation waits until none
 * is left. A holder that needs the login for longer than the shared password has left extends
 * its expiry rather than replacing it. One worker process is the only caller of the rotation,
 * so this map is the whole of the truth about who holds a login.
 *
 * `sessionsBySetRole` is the same seam over PGlite, where there is no authentication and
 * `SET ROLE` is how a test steps into a tenant. It proves the grants; the login is proven
 * against real Postgres in the Docker tier.
 */

import { asExecutor, createRolePool, type SqlExecutor } from "@undercroft/db";
import {
  extendTenantPassword,
  rotateTenantPassword,
  type TenantRoleKind,
  tenantRolesFor,
} from "@undercroft/db/repos";

import { isNoCapacity, TenantBusy } from "./tenantBusy.ts";

export interface SessionTarget {
  readonly tenantId: string;
  readonly kind: TenantRoleKind;
}

export interface TenantSessions {
  /** Run `fn` on an executor that is the tenant's `kind` login. */
  readonly as: <T>(target: SessionTarget, fn: (exec: SqlExecutor) => Promise<T>) => Promise<T>;
  /**
   * Run `fn` holding the password of the tenant's `kind` login, good for at least `validForMs`
   * -- for a child process that logs in by itself, which is dbt. No other holder of that login
   * changes the password while `fn` runs.
   */
  readonly withPassword: <T>(
    target: SessionTarget,
    validForMs: number,
    fn: (password: string) => Promise<T>,
  ) => Promise<T>;
}

export class TenantNotProvisioned extends Error {
  constructor(tenantId: string) {
    super(`tenant ${tenantId} has no roles; provision it first`);
    this.name = "TenantNotProvisioned";
  }
}

/** How long a freshly minted password lives: the SQL function's own default. */
const PASSWORD_LIFETIME_MS = 60 * 60 * 1000;
/** Headroom on every expiry, for the time between deciding and authenticating. */
const EXPIRY_MARGIN_MS = 60 * 1000;
/**
 * A pooled session authenticates once, when it opens; its login has to outlive only that. But
 * the pooler logs in to Postgres lazily, when the session's first query gets a turn -- up to its
 * `QUERY_WAIT_TIMEOUT` later (ADR 0088) -- so this is two minutes, not the seconds it takes.
 */
const SESSION_LOGIN_MS = 2 * 60 * 1000;

interface Lease {
  readonly password: string;
  /** When the password stops authenticating, by this process's clock, never later than true. */
  validUntil: number;
  holders: number;
}

/**
 * One lease per (tenant, login), for the process. Taking one is serialised per login, so two
 * holders arriving together cannot both decide to rotate; holding one is not.
 */
function createLeases(exec: SqlExecutor): TenantSessions["withPassword"] {
  const leases = new Map<string, Lease>();
  const turns = new Map<string, Promise<unknown>>();

  async function take(key: string, target: SessionTarget, validForMs: number): Promise<Lease> {
    const need = validForMs + EXPIRY_MARGIN_MS;
    const lifetime = Math.max(PASSWORD_LIFETIME_MS, need);
    const current = leases.get(key);
    // Read before the database reads its own, so the expiry kept here is never the later one.
    const from = Date.now();
    if (current === undefined || current.holders === 0) {
      const password = await rotateTenantPassword(exec, target.tenantId, target.kind, lifetime);
      const fresh: Lease = { password, validUntil: from + lifetime, holders: 1 };
      leases.set(key, fresh);
      return fresh;
    }
    if (current.validUntil - from < need) {
      await extendTenantPassword(exec, target.tenantId, target.kind, lifetime);
      current.validUntil = Math.max(current.validUntil, from + lifetime);
    }
    current.holders += 1;
    return current;
  }

  return async (target, validForMs, fn) => {
    const key = `${target.tenantId}\u0000${target.kind}`;
    const taken = (turns.get(key) ?? Promise.resolve()).then(() => take(key, target, validForMs));
    turns.set(
      key,
      taken.catch(() => undefined),
    );
    const lease = await taken;
    try {
      return await fn(lease.password);
    } finally {
      lease.holders -= 1;
    }
  };
}

function roleFor(roles: { dbtRole: string; biRole: string }, kind: TenantRoleKind): string {
  return kind === "bi" ? roles.biRole : roles.dbtRole;
}

/** The production seam: a shared password, one pool as the role, ended when `fn` settles. */
export function createTenantSessions(deps: {
  readonly exec: SqlExecutor;
  readonly dsn: string;
}): TenantSessions {
  const withPassword = createLeases(deps.exec);
  return {
    async as<T>(target: SessionTarget, fn: (exec: SqlExecutor) => Promise<T>): Promise<T> {
      const roles = await tenantRolesFor(deps.exec, target.tenantId);
      if (roles === null) {
        throw new TenantNotProvisioned(target.tenantId);
      }
      return withPassword(target, SESSION_LOGIN_MS, async (password) => {
        const pool = createRolePool(deps.dsn, { user: roleFor(roles, target.kind), password });
        try {
          // One checked-out client, so a BEGIN and the statements after it share a connection;
          // through the pool each statement could take a different one and a transaction
          // would frame nothing.
          const client = await pool.connect();
          try {
            return await fn(asExecutor(client));
          } finally {
            client.release();
          }
        } catch (error) {
          // The pooler hands out a server connection at the first query, not at login, so a
          // refusal for want of one can surface from inside `fn` -- wrapped, by the query
          // runner, as the author's failed query. Said once, here, for every caller.
          throw isNoCapacity(error) ? new TenantBusy({ cause: error }) : error;
        } finally {
          await pool.end();
        }
      });
    },
    withPassword,
  };
}

/**
 * The same seam over a single superuser connection that can `SET ROLE`: PGlite in the gate.
 * `asRole` is `TestDatabase.asRole`; the mapping still comes from `ops.tenant_role`, so a
 * tenant that was never provisioned is refused here exactly as in production. The password a
 * child logs in with is still minted and shared the production way.
 */
export function sessionsBySetRole(
  exec: SqlExecutor,
  asRole: <T>(role: string, fn: (tx: SqlExecutor) => Promise<T>) => Promise<T>,
): TenantSessions {
  return {
    async as<T>(target: SessionTarget, fn: (exec: SqlExecutor) => Promise<T>): Promise<T> {
      const roles = await tenantRolesFor(exec, target.tenantId);
      if (roles === null) {
        throw new TenantNotProvisioned(target.tenantId);
      }
      return asRole(roleFor(roles, target.kind), fn);
    },
    withPassword: createLeases(exec),
  };
}

/**
 * A tenant's database login with no connection to give in time (ADR 0088).
 *
 * Tenant logins reach Postgres through PgBouncer, which queues a login instead of refusing it,
 * but only for so long; and every login has a limit. When either runs out, nothing was wrong with
 * the request -- asked again in a moment, it runs. This names that apart from a query Postgres
 * refused, so the caller says "busy" rather than showing a pooler's error code as if the author's
 * SQL had caused it. `tenantSession.ts` is the one place it is decided.
 */

export class TenantBusy extends Error {
  constructor(options?: { cause?: unknown }) {
    super("the tenant's database login is busy; try again in a moment", options);
    this.name = "TenantBusy";
  }
}

/** Postgres's `too_many_connections`: a role's or the server's connection limit. */
const TOO_MANY_CONNECTIONS = "53300";
/**
 * PgBouncer's refusals when it has no server connection to give -- it sends them as protocol
 * errors (08P01), so the words are all there is to tell them by -- and `pg`'s own wait for a
 * connection running out. Each means "no capacity now", never "this request is wrong".
 */
const NO_CAPACITY =
  /query_wait_timeout|no more connections allowed|server login has been failing|timeout exceeded when trying to connect/u;

/** Whether `error`, or anything it wraps, is a refusal for want of a connection. */
export function isNoCapacity(error: unknown): boolean {
  for (let at: unknown = error; at instanceof Error; at = at.cause) {
    if (("code" in at && at.code === TOO_MANY_CONNECTIONS) || NO_CAPACITY.test(at.message)) {
      return true;
    }
  }
  return false;
}

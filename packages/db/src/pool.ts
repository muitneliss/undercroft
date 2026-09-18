/**
 * The `pg` connection pool, and the ONLY place `pool.query` is allowed.
 *
 * Two disciplines are enforced here rather than trusted to care:
 *
 * **Numeric and int8 come back as strings.** `pg` hands `numeric` back as a string by
 * default, but `int8` as a string too, and both are one careless `Number()` away from a
 * float. The parsers are pinned explicitly and asserted by a test, so a future `pg`
 * default cannot quietly turn an amount into a double.
 *
 * **Transactions check out one client.** `pool.query()` takes a *different* connection per
 * statement, so `BEGIN` / `SELECT ... FOR UPDATE` / `UPDATE` / `COMMIT` issued through the
 * pool acquires no lock at all -- and for Xero's rotating refresh token that is a
 * destroyed connection, not a retry. `withTransaction` checks out one client and passes
 * it down; a lint rule keeps `pool.query` out of the rest of the codebase.
 */

import pg from "pg";
import type { SqlExecutor } from "./executor.ts";

const NUMERIC_OID = 1700;
const INT8_OID = 20;

/** Return `numeric` and `int8` as strings. Idempotent; safe to call more than once. */
export function pinTypeParsers(): void {
  pg.types.setTypeParser(NUMERIC_OID, (value) => value);
  pg.types.setTypeParser(INT8_OID, (value) => value);
}

pinTypeParsers();

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

export interface PoolOptions {
  /**
   * `search_path` for every connection in the pool, e.g. `app`.
   *
   * Our own SQL always qualifies its schema (`app.app_user`, `ops.run`), so this is not for
   * us. It exists for Better Auth, which emits unqualified table names and so needs a
   * connection on which `auth_user` resolves to `app.auth_user`. Set per pool rather than on
   * the role, so a library's expectations cannot quietly change what a bare table name
   * means for everything else.
   */
  readonly searchPath?: string;
}

export function createPool(connectionString: string, options: PoolOptions = {}): pg.Pool {
  return new pg.Pool({
    connectionString,
    ...(options.searchPath === undefined
      ? {}
      : { options: `-c search_path=${options.searchPath}` }),
  });
}

/** Wrap a `pg` client as the narrow {@link SqlExecutor} the runner and repos speak. */
export function asExecutor(client: pg.PoolClient | pg.Pool): SqlExecutor {
  return {
    async query<T = Record<string, unknown>>(text: string, params?: readonly unknown[]) {
      const result = await client.query(text, params as unknown[] | undefined);
      return { rows: result.rows as T[] };
    },
    async exec(sql: string) {
      // No parameters, so the simple query protocol runs every statement in the string.
      await client.query(sql);
    },
  };
}

/**
 * Run `fn` inside a single transaction on one checked-out client.
 *
 * The only correct way to hold a row lock across statements. Commits on success, rolls
 * back on any throw, and always releases the client.
 */
export async function withTransaction<T>(
  pool: pg.Pool,
  fn: (tx: SqlExecutor) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(asExecutor(client));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

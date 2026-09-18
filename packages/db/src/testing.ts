/**
 * A PGlite-backed {@link SqlExecutor} for offline tests.
 *
 * PGlite is real Postgres compiled to WASM, single-connection and in-process. It runs the
 * actual migrations and supports `CREATE ROLE` and `SET ROLE`, which is what lets the
 * privilege model be tested in the gate rather than only against Docker.
 *
 * Its limits are real and named elsewhere: no genuine authentication (so `SET ROLE` is
 * superuser-escapable, and these tests prove the *grants* are correct, not that a hostile
 * connection cannot escalate), and one connection (so `FOR UPDATE` concurrency is an
 * integration-tier test against real Postgres). This file is exported from a `testing`
 * entry so production code cannot import PGlite by accident.
 */

// biome-ignore-all lint/nursery/noUnsafeTypeAssertion: Every one of these is a boundary where a payload genuinely is unknown -- a third-party API body, a Docker inspect response, a row shape from a hand-written query -- and is Zod-parsed or checked immediately after. Making the assertions safe means modelling each external shape as a type, which is real work with real value and is not a lint migration.

import { PGlite } from "@electric-sql/pglite";
import type { QueryResult, SqlExecutor } from "./executor.ts";

export interface TestDatabase extends SqlExecutor {
  /** Run a block as another role, resetting afterwards even on failure. */
  asRole: <T>(role: string, fn: (tx: SqlExecutor) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const db = new PGlite();
  await db.waitReady;

  const base: SqlExecutor = {
    async query<T = Record<string, unknown>>(
      text: string,
      params?: readonly unknown[],
    ): Promise<{ rows: T[] }> {
      const result = await db.query<T>(text, params as unknown[] | undefined);
      return { rows: result.rows } satisfies QueryResult<T>;
    },
    async exec(sql: string): Promise<void> {
      await db.exec(sql);
    },
  };

  return {
    ...base,
    async asRole<T>(role: string, fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      await base.query(`SET ROLE ${role}`);
      try {
        return await fn(base);
      } finally {
        await base.query("RESET ROLE");
      }
    },
    async close(): Promise<void> {
      await db.close();
    },
  };
}

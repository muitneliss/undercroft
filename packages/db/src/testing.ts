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
 *
 * WHY A SNAPSHOT. Booting PGlite runs `initdb` inside WASM, about a fifth of a second, and a
 * suite that booted one per test spent 99% of the unit gate's 174s doing exactly that --
 * the tests themselves took half a second between them. {@link createMigratedTestDatabase}
 * pays for one boot and one `migrate()` per process, dumps the data directory, and starts
 * every later database from that copy in about 60ms. Each test still owns a private
 * database, so isolation, `become` and the grant model are exactly what they were.
 */

import { PGlite } from "@electric-sql/pglite";
import type { QueryResult, SqlExecutor } from "./executor.ts";
import { migrate } from "./migrate.ts";

export interface TestDatabase extends SqlExecutor {
  /** Run a block as another role, returning to the role in force afterwards even on failure. */
  asRole: <T>(role: string, fn: (tx: SqlExecutor) => Promise<T>) => Promise<T>;
  /**
   * Run every statement from here on as `role`.
   *
   * A suite seeds its fixtures as the superuser and then becomes the role that runs the code
   * under test in production -- `undercroft_worker` for a worker suite, `undercroft_app` for
   * a control-plane one -- so a repo statement missing a grant fails in the gate rather than
   * at 02:00 with "permission denied for table". Before this existed every suite ran as the
   * superuser, and so did every service, and the grant model bound nowhere.
   *
   * PGlite's session user stays the superuser, so `asRole` can still step into any role
   * from inside a `become`, and `RESET ROLE` would step out of it; that is why `asRole`
   * returns to the become'd role rather than resetting.
   */
  become: (role: string) => Promise<void>;
  /**
   * Seed a fixture as the superuser from inside a `become`, then return to the role.
   *
   * For the rows a suite has to plant that its role may not write -- a chosen scope in
   * `app.connection_detail` for a worker suite, say. The seam is named for what it is, so a
   * reader can tell a fixture from a statement the code under test actually issues.
   */
  asSuperuser: <T>(fn: (tx: SqlExecutor) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
}

/** A fresh, empty database: no roles, no schema. For the suite that tests `migrate` itself. */
export async function createTestDatabase(): Promise<TestDatabase> {
  return await open(new PGlite());
}

let migrated: Promise<File | Blob> | undefined;

async function migratedDataDir(): Promise<File | Blob> {
  const seed = new PGlite();
  const db = await open(seed);
  await migrate(db);
  const dataDir = await seed.dumpDataDir("none");
  await db.close();
  return dataDir;
}

/**
 * A database with every migration applied, as `createTestDatabase()` + `migrate()` would
 * leave it, restored from a per-process snapshot rather than rebuilt. A suite that needs the
 * migrations run in front of it -- because it is testing them -- uses `createTestDatabase`.
 */
export async function createMigratedTestDatabase(): Promise<TestDatabase> {
  // A failed build is not cached: the next caller retries rather than inheriting the error.
  migrated ??= migratedDataDir().catch((error: unknown) => {
    migrated = undefined;
    throw error;
  });
  return await open(new PGlite({ loadDataDir: await migrated }));
}

async function open(db: PGlite): Promise<TestDatabase> {
  await db.waitReady;
  let current: string | null = null;

  const base: SqlExecutor = {
    async query<T = Record<string, unknown>>(
      text: string,
      params?: readonly unknown[],
    ): Promise<QueryResult<T>> {
      const result = await db.query<T>(text, params as unknown[] | undefined);
      return {
        rows: result.rows,
        fields: result.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
      };
    },
    async exec(sql: string): Promise<void> {
      await db.exec(sql);
    },
  };

  async function restore(): Promise<void> {
    if (current === null) {
      await base.query("RESET ROLE");
    } else {
      await base.query(`SET ROLE ${current}`);
    }
  }

  return {
    ...base,
    async asRole<T>(role: string, fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      await base.query(`SET ROLE ${role}`);
      try {
        return await fn(base);
      } finally {
        await restore();
      }
    },
    async become(role: string): Promise<void> {
      current = role;
      await base.query(`SET ROLE ${role}`);
    },
    async asSuperuser<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      await base.query("RESET ROLE");
      try {
        return await fn(base);
      } finally {
        await restore();
      }
    },
    async close(): Promise<void> {
      await db.close();
    },
  };
}

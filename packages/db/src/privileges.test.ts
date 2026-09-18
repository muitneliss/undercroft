/**
 * The privilege model, pinned. This is the credential-leak hazard closed by test.
 *
 * These run in the gate because PGlite gives real `CREATE ROLE` / `SET ROLE`. They prove
 * the grants are correct; that a hostile connection cannot escalate past `SET ROLE` is an
 * integration-tier concern against real Postgres with real login roles.
 */

// biome-ignore-all lint/nursery/noBunModules: Bun is the test runner, per CLAUDE.md: 'Bun is the runtime, package manager, workspace manager and test runner.' `bun:test` is the toolchain, not an accidental dependency.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { SqlExecutor } from "./executor.ts";
import { migrate } from "./migrate.ts";
import { createTestDatabase, type TestDatabase } from "./testing.ts";

let db: TestDatabase;

beforeEach(async () => {
  db = await createTestDatabase();
  await migrate(db);
});

afterEach(async () => {
  await db.close();
});

async function expectDenied(fn: () => Promise<unknown>): Promise<void> {
  // A guard needs its firing case AND its quiet case; this is the firing side.
  try {
    await fn();
    throw new Error("expected a permission error, but the query succeeded");
  } catch (error) {
    expect((error as Error).message).toMatch(/permission denied|not.*allowed/iu);
  }
}

describe("the default-privilege grant is unique and correctly scoped", () => {
  test("pg_default_acl has exactly one row: dbt -> bi in analytics", async () => {
    // The structural control. A second ALTER DEFAULT PRIVILEGES anywhere -- the exact
    // shape of the original hazard -- makes this fail.
    const { rows } = await db.query<{ grantor: string; schema: string; objtype: string }>(
      `SELECT pg_get_userbyid(defaclrole) AS grantor,
              n.nspname AS schema,
              defaclobjtype AS objtype
       FROM pg_default_acl d
       JOIN pg_namespace n ON n.oid = d.defaclnamespace`,
    );
    expect(rows).toEqual([{ grantor: "undercroft_dbt", schema: "analytics", objtype: "r" }]);
  });
});

describe("a table dbt creates at runtime reaches BI, and only BI-safe schemas do", () => {
  test("BI can read a table dbt created after the migrations ran", async () => {
    await db.asRole("undercroft_dbt", async (tx: SqlExecutor) => {
      await tx.exec("CREATE TABLE analytics.fct_demo AS SELECT 1 AS n");
    });
    const rows = await db.asRole("undercroft_bi", (tx) =>
      tx.query<{ n: number }>("SELECT n FROM analytics.fct_demo"),
    );
    expect(rows.rows[0]?.n).toBe(1);
  });

  test("BI cannot reach credentials, raw payloads, or quarantine by any route", async () => {
    await db.asRole("undercroft_bi", async (tx) => {
      await expectDenied(() => tx.query("SELECT * FROM app.connection_secret"));
      await expectDenied(() => tx.query("SELECT * FROM raw.records"));
      await expectDenied(() => tx.query("SELECT * FROM dq.dummy"));
    });
  });
});

describe("every table in app is granted to the control plane, and to nothing else", () => {
  // The hazard: `040_grants.sql` grants `ON ALL TABLES IN SCHEMA app`, which Postgres
  // expands to the tables existing at that moment, and the ledger means it never runs
  // again. So a table added by a later migration silently has NO grants -- the control
  // plane gets "permission denied for table" on first use while the whole suite stays
  // green. This enumerates the schema instead of naming tables, so it covers the next
  // table too, not just today's.
  test("no table in app is missing the control plane's DML grants", async () => {
    const { rows } = await db.query<{
      table_name: string;
      can_select: boolean;
      can_insert: boolean;
      can_update: boolean;
      can_delete: boolean;
    }>(
      `SELECT c.relname AS table_name,
              has_table_privilege('undercroft_app', c.oid, 'SELECT') AS can_select,
              has_table_privilege('undercroft_app', c.oid, 'INSERT') AS can_insert,
              has_table_privilege('undercroft_app', c.oid, 'UPDATE') AS can_update,
              has_table_privilege('undercroft_app', c.oid, 'DELETE') AS can_delete
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'app' AND c.relkind = 'r'
       ORDER BY c.relname`,
    );

    // The schema is not empty, or the query above would pass by vacuity.
    expect(rows.length).toBeGreaterThan(0);
    const ungranted = rows.filter(
      (r) => !(r.can_select && r.can_insert && r.can_update && r.can_delete),
    );
    expect(ungranted.map((r) => r.table_name)).toEqual([]);
  });

  test("BI cannot read a session, a login identity or an OAuth token", async () => {
    // The quiet side of the same boundary: app is revoked from BI wholesale, so the tables
    // that hold a live session token are unreachable rather than merely ungranted.
    await db.asRole("undercroft_bi", async (tx) => {
      await expectDenied(() => tx.query("SELECT * FROM app.auth_user"));
      await expectDenied(() => tx.query("SELECT * FROM app.auth_session"));
      await expectDenied(() => tx.query("SELECT * FROM app.auth_account"));
      await expectDenied(() => tx.query("SELECT * FROM app.auth_verification"));
    });
  });
});

describe("a user-authored dbt model cannot read a credential", () => {
  test("dbt has no USAGE on app, so a model selecting the secret fails", async () => {
    // The primary control, and it is a privilege rather than a policy: the model fails at
    // execution because its role cannot see the schema at all.
    await db.asRole("undercroft_dbt", async (tx) => {
      await expectDenied(() =>
        tx.exec("CREATE TABLE analytics.leak AS SELECT * FROM app.connection_secret"),
      );
    });
  });

  test("dbt cannot create outside analytics and dq", async () => {
    await db.asRole("undercroft_dbt", async (tx) => {
      await expectDenied(() => tx.exec("CREATE TABLE ops.sneaky (n int)"));
    });
  });
});

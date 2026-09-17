/**
 * The privilege model, pinned. This is the credential-leak hazard closed by test.
 *
 * These run in the gate because PGlite gives real `CREATE ROLE` / `SET ROLE`. They prove
 * the grants are correct; that a hostile connection cannot escalate past `SET ROLE` is an
 * integration-tier concern against real Postgres with real login roles.
 */

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
    expect((error as Error).message).toMatch(/permission denied|not.*allowed/i);
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

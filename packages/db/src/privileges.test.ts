/**
 * The privilege model, pinned. This is the credential-leak hazard closed by test.
 *
 * These run in the gate because PGlite gives real `CREATE ROLE` / `SET ROLE`. They prove
 * the grants are correct; that a hostile connection cannot escalate past `SET ROLE` is an
 * integration-tier concern against real Postgres with real login roles.
 */

// biome-ignore-all lint/nursery/noUnsafeTypeAssertion: Every one of these is a boundary where a payload genuinely is unknown -- a third-party API body, a Docker inspect response, a row shape from a hand-written query -- and is Zod-parsed or checked immediately after. Making the assertions safe means modelling each external shape as a type, which is real work with real value and is not a lint migration.
// biome-ignore-all lint/performance/useTopLevelRegex: Worth doing, and not done here: hoisting these 45 literals is a real change to 22 files and belongs in its own commit where the diff is reviewable, not buried in a lint migration. Recorded rather than silently dropped.

// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys (Invoices, InvoiceID), HTTP header names, and Better Auth's option keys (baseURL, storeOTP) and table names (auth_user). strictCase cannot be satisfied by code that talks to another system.

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
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
  it("pg_default_acl has exactly one row: dbt -> bi in analytics", async () => {
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
  it("BI can read a table dbt created after the migrations ran", async () => {
    await db.asRole("undercroft_dbt", async (tx: SqlExecutor) => {
      await tx.exec("CREATE TABLE analytics.fct_demo AS SELECT 1 AS n");
    });
    const rows = await db.asRole("undercroft_bi", (tx) =>
      tx.query<{ n: number }>("SELECT n FROM analytics.fct_demo"),
    );
    expect(rows.rows[0]?.n).toBe(1);
  });

  it("BI cannot reach credentials, raw payloads, or quarantine by any route", async () => {
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
  it("no table in app is missing the control plane's DML grants", async () => {
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

  it("BI cannot read a session, a login identity or an OAuth token", async () => {
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
  it("dbt has no USAGE on app, so a model selecting the secret fails", async () => {
    // The primary control, and it is a privilege rather than a policy: the model fails at
    // execution because its role cannot see the schema at all.
    await db.asRole("undercroft_dbt", async (tx) => {
      await expectDenied(() =>
        tx.exec("CREATE TABLE analytics.leak AS SELECT * FROM app.connection_secret"),
      );
    });
  });

  it("dbt cannot create outside analytics and dq", async () => {
    await db.asRole("undercroft_dbt", async (tx) => {
      await expectDenied(() => tx.exec("CREATE TABLE ops.sneaky (n int)"));
    });
  });
});

describe("the worker can seal a credential, and cannot choose what it reads", () => {
  // The worker is the only process holding the master key, so it is the only role that may
  // create a connection and store a sealed credential. It is NOT the role that decides what
  // a customer shared -- that is an admin's decision in the control plane. The pair below
  // is that boundary from both sides.
  beforeEach(async () => {
    await db.exec("INSERT INTO ops.tenant (id, display_name) VALUES ('CASE-0042', 'Acme')");
  });

  it("the worker can create a connection and store a sealed credential", async () => {
    // The quiet side. Every statement here is one `storeCredential` actually runs; before
    // 070 the worker held only SELECT on ops.connection and could not have run any of them.
    await db.asRole("undercroft_worker", async (tx) => {
      await tx.query(
        `INSERT INTO ops.connection (tenant_id, source, status) VALUES ($1, $2, 'connected')
         ON CONFLICT (tenant_id, source) DO UPDATE SET status = EXCLUDED.status`,
        ["CASE-0042", "gmail"],
      );
      await tx.query(
        `INSERT INTO app.connection_secret (tenant_id, source, ciphertext, key_version)
         VALUES ($1, $2, $3, 1)`,
        ["CASE-0042", "gmail", Buffer.from("sealed")],
      );
      await tx.query("UPDATE ops.connection SET status = 'expired' WHERE tenant_id = $1", [
        "CASE-0042",
      ]);
    });

    const { rows } = await db.query<{ status: string }>(
      "SELECT status FROM ops.connection WHERE tenant_id = $1",
      ["CASE-0042"],
    );
    expect(rows[0]?.status).toBe("expired");
  });

  it("the worker can read a chosen scope but cannot change one", async () => {
    await db.query("INSERT INTO ops.connection (tenant_id, source) VALUES ($1, $2)", [
      "CASE-0042",
      "gmail",
    ]);
    await db.query(
      "INSERT INTO app.connection_detail (tenant_id, source, selection) VALUES ($1, $2, $3::jsonb)",
      ["CASE-0042", "gmail", '{"labels":[]}'],
    );

    await db.asRole("undercroft_worker", async (tx) => {
      const { rows } = await tx.query<{ selection: unknown }>(
        "SELECT selection FROM app.connection_detail WHERE tenant_id = $1",
        ["CASE-0042"],
      );
      expect(rows).toHaveLength(1);

      // The firing side: widening its own grant is exactly what the worker must not do.
      await expectDenied(() =>
        tx.query("UPDATE app.connection_detail SET selection = '{}'::jsonb WHERE tenant_id = $1", [
          "CASE-0042",
        ]),
      );
    });
  });

  it("BI cannot read a mailbox address or an in-flight consent", async () => {
    // app is revoked from BI wholesale, so both new tables are unreachable rather than
    // merely ungranted -- the same argument that keeps a label name off a dashboard.
    await db.asRole("undercroft_bi", async (tx) => {
      await expectDenied(() => tx.query("SELECT * FROM app.connection_detail"));
      await expectDenied(() => tx.query("SELECT * FROM app.oauth_handshake"));
    });
  });
});

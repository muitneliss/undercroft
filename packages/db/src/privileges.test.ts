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

/** What a call was refused with, or `""` when it was not refused at all. */
async function refusalOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (error) {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}

async function defaultAcls(): Promise<{ grantor: string; schema: string; objtype: string }[]> {
  const { rows } = await db.query<{ grantor: string; schema: string; objtype: string }>(
    `SELECT pg_get_userbyid(defaclrole) AS grantor,
            n.nspname AS schema,
            defaclobjtype AS objtype
     FROM pg_default_acl d
     JOIN pg_namespace n ON n.oid = d.defaclnamespace
     ORDER BY 1, 2`,
  );
  return rows;
}

describe("every default privilege is the one a tenant's own role was given, and no other", () => {
  it("with no tenant, pg_default_acl has exactly the legacy row: dbt -> bi in analytics", async () => {
    // The structural control ADR 0005 introduced, kept: a hand-written ALTER DEFAULT
    // PRIVILEGES anywhere -- the exact shape of the original hazard -- makes this fail.
    expect(await defaultAcls()).toEqual([
      { grantor: "undercroft_dbt", schema: "analytics", objtype: "r" },
    ]);
  });

  it("with tenants, the set is derived from ops.tenant_role and matches in full", async () => {
    // ADR 0018: none written by hand, one per tenant issued by provisioning. Derived rather
    // than listed, so a provisioning bug that forgets a tenant fails the same way a stray
    // default does.
    await db.exec("INSERT INTO ops.tenant (id) VALUES ('CASE-0042'), ('CASE-0043')");
    await db.query("SELECT ops.provision_tenant('CASE-0042')");
    await db.query("SELECT ops.provision_tenant('CASE-0043')");

    const { rows: tenants } = await db.query<{ role_name: string; slug: string }>(
      "SELECT role_name, slug FROM ops.tenant_role WHERE kind = 'dbt' ORDER BY role_name",
    );
    const expected = [
      { grantor: "undercroft_dbt", schema: "analytics", objtype: "r" },
      ...tenants.map((t) => ({
        grantor: t.role_name,
        schema: `analytics_${t.slug}`,
        objtype: "r",
      })),
    ].sort((a, b) => a.grantor.localeCompare(b.grantor));
    expect(await defaultAcls()).toEqual(expected);
  });
});

describe("each tenant's SQL runs as its own role and sees only its own rows", () => {
  beforeEach(async () => {
    await db.exec("INSERT INTO ops.tenant (id) VALUES ('CASE-0042'), ('CASE-0043')");
    await db.query("SELECT ops.provision_tenant('CASE-0042')");
    await db.query("SELECT ops.provision_tenant('CASE-0043')");
    await db.exec("CREATE TABLE raw.records_demo PARTITION OF raw.records FOR VALUES IN ('demo')");
    // One row per tenant in each table, so "only its own" has something to be measured against.
    await db.exec(
      `INSERT INTO raw.records (source, tenant_id, entity, source_record_id, payload,
         content_sha256, observed_at, lake_key, lake_stamp, run_id)
       VALUES ('demo', 'CASE-0042', 'things', '1', '{"n":1}'::jsonb, repeat('0', 64), now(), 'k', 's', 'r'),
              ('demo', 'CASE-0043', 'things', '1', '{"n":1}'::jsonb, repeat('0', 64), now(), 'k', 's', 'r')`,
    );
    await db.exec(
      `INSERT INTO raw.documents (source, tenant_id, document_id, lake_key, sha256, byte_length, observed_at, run_id)
       VALUES ('demo', 'CASE-0042', 'd1', 'k', repeat('0', 64), 1, now(), 'r'),
              ('demo', 'CASE-0043', 'd1', 'k', repeat('0', 64), 1, now(), 'r')`,
    );
  });

  it("provisioning is idempotent and names the roles and schemas from the slug", async () => {
    await db.query("SELECT ops.provision_tenant('CASE-0042')");
    const { rows } = await db.query<{ kind: string; role_name: string; slug: string }>(
      "SELECT kind, role_name, slug FROM ops.tenant_role WHERE tenant_id = 'CASE-0042' ORDER BY kind",
    );
    expect(rows).toEqual([
      { kind: "bi", role_name: "undercroft_bi_case_0042", slug: "case_0042" },
      { kind: "dbt", role_name: "undercroft_dbt_case_0042", slug: "case_0042" },
    ]);
    const { rows: schemas } = await db.query<{ nspname: string; owner: string }>(
      `SELECT nspname, pg_get_userbyid(nspowner) AS owner FROM pg_namespace
       WHERE nspname IN ('analytics_case_0042', 'dq_case_0042') ORDER BY nspname`,
    );
    expect(schemas).toEqual([
      { nspname: "analytics_case_0042", owner: "undercroft_dbt_case_0042" },
      { nspname: "dq_case_0042", owner: "undercroft_dbt_case_0042" },
    ]);
  });

  it("a tenant's dbt role reads its own rows and no other tenant's, through the parent", async () => {
    const seen = await db.asRole("undercroft_dbt_case_0042", (tx) =>
      tx.query<{ tenant_id: string }>("SELECT tenant_id FROM raw.records ORDER BY tenant_id"),
    );
    expect(seen.rows.map((r) => r.tenant_id)).toEqual(["CASE-0042"]);

    const docs = await db.asRole("undercroft_dbt_case_0042", (tx) =>
      tx.query<{ tenant_id: string }>("SELECT tenant_id FROM raw.documents"),
    );
    expect(docs.rows.map((r) => r.tenant_id)).toEqual(["CASE-0042"]);
  });

  it("naming a partition directly is a permission error, not a way round the policy", async () => {
    await db.asRole("undercroft_dbt_case_0042", async (tx) => {
      await expectDenied(() => tx.query("SELECT * FROM raw.records_demo"));
      await expectDenied(() => tx.query("SELECT * FROM raw.records_default"));
    });
  });

  it("the platform roles still see every row, and the legacy shared dbt role sees none", async () => {
    const worker = await db.asRole("undercroft_worker", (tx) =>
      tx.query<{ n: string }>("SELECT count(*)::text AS n FROM raw.records"),
    );
    expect(worker.rows[0]?.n).toBe("2");
    const app = await db.asRole("undercroft_app", (tx) =>
      tx.query<{ n: string }>("SELECT count(*)::text AS n FROM raw.records"),
    );
    expect(app.rows[0]?.n).toBe("2");
    const legacy = await db.asRole("undercroft_dbt", (tx) =>
      tx.query<{ n: string }>("SELECT count(*)::text AS n FROM raw.records"),
    );
    expect(legacy.rows[0]?.n).toBe("0");
  });

  it("a tenant's dbt role creates in its own schemas and is refused everywhere else", async () => {
    await db.asRole("undercroft_dbt_case_0042", async (tx) => {
      await tx.exec("CREATE TABLE analytics_case_0042.fct AS SELECT 1 AS n");
      await tx.exec("CREATE TABLE dq_case_0042.failures AS SELECT 1 AS n");
      await expectDenied(() => tx.exec("CREATE TABLE analytics_case_0043.sneaky (n int)"));
      await expectDenied(() => tx.exec("CREATE TABLE analytics.sneaky (n int)"));
      await expectDenied(() => tx.exec("CREATE TABLE ops.sneaky (n int)"));
      await expectDenied(() => tx.query("SELECT * FROM app.connection_secret"));
    });
  });

  it("a tenant's bi role reads what its dbt role created afterwards, and nothing else", async () => {
    await db.asRole("undercroft_dbt_case_0042", async (tx) => {
      await tx.exec("CREATE TABLE analytics_case_0042.fct AS SELECT 1 AS n");
      await tx.exec("CREATE TABLE dq_case_0042.failures AS SELECT 1 AS n");
    });
    await db.asRole("undercroft_dbt_case_0043", async (tx) => {
      await tx.exec("CREATE TABLE analytics_case_0043.fct AS SELECT 2 AS n");
    });

    const own = await db.asRole("undercroft_bi_case_0042", (tx) =>
      tx.query<{ n: number }>("SELECT n FROM analytics_case_0042.fct"),
    );
    expect(own.rows[0]?.n).toBe(1);

    await db.asRole("undercroft_bi_case_0042", async (tx) => {
      await expectDenied(() => tx.query("SELECT * FROM analytics_case_0043.fct"));
      await expectDenied(() => tx.query("SELECT * FROM dq_case_0042.failures"));
      await expectDenied(() => tx.query("SELECT * FROM raw.records"));
      await expectDenied(() => tx.query("SELECT * FROM app.connection_secret"));
      await expectDenied(() => tx.query("SELECT * FROM ops.tenant_role"));
      await expectDenied(() => tx.exec("CREATE TABLE analytics_case_0042.mine (n int)"));
    });
  });

  it("only the worker may rotate a password, and the value it gets is not stored anywhere", async () => {
    const minted = await db.asRole("undercroft_worker", (tx) =>
      tx.query<{ password: string }>(
        "SELECT ops.rotate_tenant_password('CASE-0042', 'bi') AS password",
      ),
    );
    const password = minted.rows[0]?.password ?? "";
    expect(password).toMatch(/^[0-9a-f]{64}$/u);

    const { rows } = await db.query<{ rolvaliduntil: string | null }>(
      "SELECT rolvaliduntil::text FROM pg_roles WHERE rolname = 'undercroft_bi_case_0042'",
    );
    expect(rows[0]?.rolvaliduntil).not.toBeNull();

    await db.asRole("undercroft_app", async (tx) => {
      await expectDenied(() => tx.query("SELECT ops.rotate_tenant_password('CASE-0042', 'bi')"));
    });
    await db.asRole("undercroft_bi_case_0042", async (tx) => {
      await expectDenied(() => tx.query("SELECT ops.rotate_tenant_password('CASE-0042', 'bi')"));
    });
  });

  it("a reference that folds to an existing tenant's slug is refused before any role exists", async () => {
    await db.exec("INSERT INTO ops.tenant (id) VALUES ('case_0042')");
    const refusal = await refusalOf(() => db.query("SELECT ops.provision_tenant('case_0042')"));
    expect(refusal).toMatch(/already belongs to another tenant/u);
    const { rows } = await db.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM ops.tenant_role WHERE tenant_id = 'case_0042'",
    );
    expect(rows[0]?.n).toBe("0");
  });

  it("a reference too long to make a role name is refused", async () => {
    const long = `CASE-${"x".repeat(50)}`;
    await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [long]);
    const refusal = await refusalOf(() => db.query("SELECT ops.provision_tenant($1)", [long]));
    expect(refusal).toMatch(/no usable role name/u);
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

describe("a run's event feed is granted like a refusal, not like a run", () => {
  // ops.run is readable by BI on purpose: whether a sync happened is a reportable fact.
  // The feed under it is not -- it is the same category as ops.run_refusal, whose reason
  // may quote a payload key. Both halves are pinned: it is written by the worker and read
  // by the control plane, and it is reachable from neither the BI nor the dbt side.
  it("the worker appends and the control plane reads", async () => {
    await db.exec("INSERT INTO ops.tenant (id) VALUES ('CASE-0042')");
    await db.asRole("undercroft_worker", async (tx) => {
      await tx.query(
        `INSERT INTO ops.run (id, tenant_id, source, verb, trigger)
         VALUES ('r1', 'CASE-0042', 'gmail', 'ingest', 'manual')`,
      );
      await tx.query(
        `INSERT INTO ops.run_event (run_id, level, event, detail)
         VALUES ('r1', 'info', 'work_listed', '{"total": 12}'::jsonb)`,
      );
    });
    const seen = await db.asRole("undercroft_app", (tx) =>
      tx.query<{ event: string }>("SELECT event FROM ops.run_event WHERE run_id = 'r1'"),
    );
    expect(seen.rows[0]?.event).toBe("work_listed");
  });

  it("BI and dbt are refused it, while BI still reads the run itself", async () => {
    await db.asRole("undercroft_bi", async (tx) => {
      await tx.query("SELECT count(*) FROM ops.run");
      await expectDenied(() => tx.query("SELECT * FROM ops.run_event"));
      await expectDenied(() => tx.query("SELECT * FROM ops.run_refusal"));
    });
    await db.asRole("undercroft_dbt", async (tx) => {
      await expectDenied(() => tx.query("SELECT * FROM ops.run_event"));
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

/**
 * The build verb end to end: a model is built as the tenant, the run lands in the ledger
 * with its steps, the model's columns are recorded, and the first rows come back as the
 * tenant's BI login -- which is what proves a dashboard can see what the author built.
 * And the dq verb: the rows a failed test stored, readable only where dbt put them.
 *
 * dbt is the fake from the transform suite: it does to the database what the real one
 * would, as the login the real one would be, and writes dbt's own results file.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStampSource, TestClock } from "@undercroft/core";
import { migrate } from "@undercroft/db";
import { getModel, saveModel } from "@undercroft/db/repos";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { InMemoryObjectStore, LakeStore } from "@undercroft/lake";

import { drainJobs } from "../services/jobs.ts";
import { sessionsBySetRole } from "../services/tenantSession.ts";
import type { Spawn } from "../services/transform.ts";
import { createLakeApi } from "./lake.ts";

const TENANT = "CASE-1";

let db: TestDatabase;
let workDir: string;

function writeResults(dir: string, results: unknown[]): void {
  mkdirSync(join(dir, "target"), { recursive: true });
  writeFileSync(join(dir, "target", "run_results.json"), JSON.stringify({ results }));
}

/** dbt, as far as the database can tell: the table appears, as the tenant's dbt login. */
const fakeDbt: Spawn = async (_cmd, options) => {
  await db.asRole("undercroft_dbt_case_1", (tx) =>
    tx.exec(
      `CREATE TABLE analytics_case_1.stg_deals AS
         SELECT 1 AS deal_id, 'Acme'::text AS deal_name, 12345.6789::numeric(18,4) AS amount
       UNION ALL SELECT 2, NULL, NULL;
       CREATE TABLE dq_case_1.not_null_stg_deals_deal_name AS
         SELECT 2 AS deal_id, NULL::text AS deal_name`,
    ),
  );
  writeResults(options.cwd, [
    {
      unique_id: "model.undercroft.stg_deals",
      status: "success",
      message: "CREATE TABLE",
      failures: null,
      execution_time: 0.2,
      relation_name: '"undercroft"."analytics_case_1"."stg_deals"',
    },
    {
      unique_id: "test.undercroft.not_null_stg_deals_deal_name.a1",
      status: "fail",
      message: "Got 1 result",
      failures: 1,
      execution_time: 0.1,
      relation_name: '"undercroft"."dq_case_1"."not_null_stg_deals_deal_name"',
    },
  ]);
  return { exitCode: 1, output: "Done. PASS=1 FAIL=1" };
};

function api(spawn: Spawn = fakeDbt) {
  return createLakeApi({
    lake: new LakeStore(new InMemoryObjectStore(), { stamps: createStampSource(new TestClock()) }),
    exec: db,
    serviceToken: "svc-token",
    dbt: {
      database: { host: "db.internal", port: 5432, dbname: "undercroft" },
      sessions: sessionsBySetRole(db, (role, fn) => db.asRole(role, fn)),
      spawn,
      workDir,
    },
  });
}

function post(app: ReturnType<typeof api>, path: string, body: unknown, token = "svc-token") {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  db = await createTestDatabase();
  await migrate(db);
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1), ('CASE-2')", [TENANT]);
  await saveModel(db, TENANT, {
    name: "stg_deals",
    sql: "select 1 as deal_id",
    tests: { columns: { deal_name: ["not_null"] } },
    updatedBy: "u-1",
  });
  workDir = mkdtempSync(join(tmpdir(), "undercroft-build-test-"));
  await db.become("undercroft_worker");
});

afterEach(async () => {
  await drainJobs();
  await db.close();
});

describe("POST /v1/models/build", () => {
  it("builds the model as the tenant and answers with the run, its steps and the first rows", async () => {
    const res = await post(api(), "/v1/models/build", {
      tenantId: TENANT,
      model: "stg_deals",
      triggeredBy: "u-1",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      runId: string;
      ok: boolean;
      testsFailed: number;
      steps: { kind: string; name: string; status: string }[];
      preview: { columns: { name: string; type: string }[]; rows: unknown[][]; truncated: boolean };
    };

    expect(body.ok).toBe(true);
    expect(body.testsFailed).toBe(1);
    expect(body.steps.map((s) => [s.kind, s.name, s.status])).toEqual([
      ["model", "stg_deals", "success"],
      ["test", "not_null_stg_deals_deal_name", "fail"],
    ]);
    // Read as the BI login: the columns with Postgres's type names, and the numeric as a
    // string with every digit.
    expect(body.preview.columns).toEqual([
      { name: "deal_id", type: "integer" },
      { name: "deal_name", type: "text" },
      { name: "amount", type: "numeric" },
    ]);
    expect(body.preview.rows).toEqual([
      [1, "Acme", "12345.6789"],
      [2, null, null],
    ]);
    expect(body.preview.truncated).toBe(false);

    // The ledger holds the run as a build, and the model knows its columns now.
    const { rows } = await db.query<{ status: string; trigger: string; tests_failed: number }>(
      "SELECT status, trigger, tests_failed FROM ops.run WHERE id = $1",
      [body.runId],
    );
    expect(rows[0]).toEqual({ status: "ok", trigger: "build", tests_failed: 1 });
    expect((await getModel(db, TENANT, "stg_deals"))?.columns).toEqual([
      "deal_id",
      "deal_name",
      "amount",
    ]);
  });

  it("a build that broke the model answers ok:false with dbt's message and no preview", async () => {
    const broken: Spawn = (_cmd, options) => {
      writeResults(options.cwd, [
        {
          unique_id: "model.undercroft.stg_deals",
          status: "error",
          message: 'column "nope" does not exist',
          failures: null,
          execution_time: 0.1,
          relation_name: null,
        },
      ]);
      return Promise.resolve({ exitCode: 1, output: "Database Error" });
    };
    const res = await post(api(broken), "/v1/models/build", {
      tenantId: TENANT,
      model: "stg_deals",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; error: string | null; preview: unknown };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('column "nope" does not exist');
    expect(body.preview).toBeNull();
  });

  it("refuses a caller without the service token, and a body with no model", async () => {
    expect(
      (await post(api(), "/v1/models/build", { tenantId: TENANT, model: "stg_deals" }, "nope"))
        .status,
    ).toBe(401);
    expect((await post(api(), "/v1/models/build", { tenantId: TENANT })).status).toBe(400);
  });
});

describe("POST /v1/dq/failures", () => {
  it("reads the rows a failed test stored, as the tenant's dbt login", async () => {
    const app = api();
    const built = (await (
      await post(app, "/v1/models/build", { tenantId: TENANT, model: "stg_deals" })
    ).json()) as { runId: string };

    const res = await post(app, "/v1/dq/failures", {
      tenantId: TENANT,
      runId: built.runId,
      uniqueId: "test.undercroft.not_null_stg_deals_deal_name.a1",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      columns: [
        { name: "deal_id", type: "integer" },
        { name: "deal_name", type: "text" },
      ],
      rows: [[2, null]],
      truncated: false,
    });
  });

  it("another tenant's run is not found, and a model step is not a test", async () => {
    const app = api();
    const built = (await (
      await post(app, "/v1/models/build", { tenantId: TENANT, model: "stg_deals" })
    ).json()) as { runId: string };

    const other = await post(app, "/v1/dq/failures", {
      tenantId: "CASE-2",
      runId: built.runId,
      uniqueId: "test.undercroft.not_null_stg_deals_deal_name.a1",
    });
    expect(other.status).toBe(404);
    const model = await post(app, "/v1/dq/failures", {
      tenantId: TENANT,
      runId: built.runId,
      uniqueId: "model.undercroft.stg_deals",
    });
    expect(model.status).toBe(404);
  });
});

/**
 * The build verb end to end: a model is built as the tenant, the run lands in the ledger
 * with its steps, the model's columns are recorded, and the first rows come back as the
 * tenant's BI login -- which is what proves a dashboard can see what the author built.
 * And the dq verb: the rows a failed test stored, readable only where dbt put them. And the
 * drop verb: what a model built goes, as the login that built it, and nothing another model
 * owns or reads from goes with it.
 *
 * dbt is the fake from the transform suite: it does to the database what the real one
 * would, as the login the real one would be, and writes dbt's own results file.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStampSource, TestClock } from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";
import { getModel, openRun, provisionTenantRoles, saveModel } from "@undercroft/db/repos";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { InMemoryObjectStore, LakeStore } from "@undercroft/lake";

import { drainJobs } from "../services/jobs.ts";
import { createSlots, type RunTurns } from "../services/slots.ts";
import { TenantBusy } from "../services/tenantBusy.ts";
import { sessionsBySetRole, type TenantSessions } from "../services/tenantSession.ts";
import type { Spawn } from "../services/transform.ts";
import { noDatabase } from "../testing.ts";
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
  return { exitCode: 1, stdout: "Done. PASS=1 FAIL=1", stderr: "" };
};

/**
 * What dbt 1.9 prints when it stops before its first model: this startup banner, then its own
 * account of why. Captured from a real `dbt build --no-use-colors` that was refused a login.
 */
const BANNER = [
  "11:09:28  Running with dbt=1.9.1",
  "11:09:29  Registered adapter: postgres=1.9.0",
  "11:09:29  Unable to do partial parsing because saved manifest not found. Starting full parse.",
  "11:09:31  Found 44 models, 123 data tests, 2 sources, 437 macros",
  "11:09:31  ",
  "11:09:31  Concurrency: 4 threads (target='tenant')",
  "11:09:31  ",
  "11:09:32  ",
  "11:09:32  Finished running  in 0 hours 0 minutes and 0.13 seconds (0.13s).",
].join("\n");

/** dbt that stopped before any model: exit 2, the banner and then `cause`, no results file. */
function stoppedEarly(cause: string): Spawn {
  return () =>
    Promise.resolve({ exitCode: 2, stdout: `${BANNER}\n11:09:32  ${cause}\n  `, stderr: "" });
}

/**
 * The API with dbt wired. `exec` is `noDatabase` only for requests refused before any SQL;
 * `limits` are the worker's turns and stop signal, absent for everything but the queue.
 */
function api(
  spawn: Spawn = fakeDbt,
  exec: SqlExecutor = db,
  limits: { turns?: RunTurns; stop?: AbortSignal } = {},
) {
  return createLakeApi({
    lake: new LakeStore(new InMemoryObjectStore(), { stamps: createStampSource(new TestClock()) }),
    exec,
    serviceToken: "svc-token",
    dbt: {
      database: { host: "db.internal", port: 5432, dbname: "undercroft" },
      sessions: sessionsBySetRole(exec, (role, fn) => db.asRole(role, fn)),
      spawn,
      workDir,
    },
    ...limits,
  });
}

function post(app: ReturnType<typeof api>, path: string, body: unknown, token = "svc-token") {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "undercroft-build-test-"));
});

/**
 * A migrated database holding one tenant's saved model, entered as the worker. Per describe,
 * so the refusals at the end of the file do not open a database they never reach.
 */
function withDatabase(): void {
  beforeEach(async () => {
    db = await createMigratedTestDatabase();
    await db.query("INSERT INTO ops.tenant (id) VALUES ($1), ('CASE-2')", [TENANT]);
    await saveModel(db, TENANT, {
      name: "stg_deals",
      sql: "select 1 as deal_id",
      tests: { columns: { deal_name: ["not_null"] } },
      updatedBy: "u-1",
    });
    await db.become("undercroft_worker");
  });

  afterEach(async () => {
    await drainJobs();
    await db.close();
  });
}

describe("POST /v1/models/build", () => {
  withDatabase();

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
      return Promise.resolve({ exitCode: 1, stdout: "Database Error", stderr: "" });
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

  // #336: the run kept the first 500 characters of dbt's last lines, the banner filled them,
  // and the cause was cut off at the "E" of "Encountered".
  it("a build dbt stopped before its first model records dbt's own cause, not its banner", async () => {
    const refused =
      'Encountered an error:\nDatabase Error\n  connection to server at "db.internal" (10.0.0.5), port 5432 failed: FATAL:  password authentication failed for user "undercroft_dbt_case_1"';
    const res = await post(api(stoppedEarly(refused)), "/v1/models/build", {
      tenantId: TENANT,
      model: "stg_deals",
    });
    const body = (await res.json()) as { ok: boolean; error: string | null };

    expect(body.ok).toBe(false);
    expect(body.error).toContain(
      'Encountered an error:\nDatabase Error\nconnection to server at "db.internal" (10.0.0.5), port 5432 failed: FATAL:  password authentication failed for user "undercroft_dbt_case_1"',
    );
    expect(body.error).not.toContain("Running with dbt");
  });

  it("a cause longer than the run keeps is cut at its end, never at its start", async () => {
    const cause = `Encountered an error:\nCompilation Error\n${"in macro trimmed ".repeat(60)}`;
    const res = await post(api(stoppedEarly(cause)), "/v1/models/build", {
      tenantId: TENANT,
      model: "stg_deals",
    });
    const body = (await res.json()) as { error: string | null };

    expect(body.error?.length).toBe(500);
    expect(body.error).toContain("Encountered an error:\nCompilation Error\nin macro trimmed");
  });
});

/** A dbt that holds every build open until `release`, and counts the builds it started. */
function heldDbt(): { spawn: Spawn; started: () => number; release: () => void } {
  const gate = Promise.withResolvers<void>();
  let started = 0;
  return {
    spawn: async (_cmd, options) => {
      started += 1;
      await gate.promise;
      writeResults(options.cwd, []);
      return { exitCode: 0, stdout: "", stderr: "" };
    },
    started: () => started,
    release: () => gate.resolve(),
  };
}

/** Poll until `holds` is true: the public state a background build reaches, not a sleep. */
async function until(holds: () => boolean | Promise<boolean>): Promise<void> {
  for (let tries = 0; tries < 500; tries += 1) {
    if (await holds()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("the awaited state never came");
}

async function runOf(runId: string): Promise<{ status: string; error: string | null }> {
  const { rows } = await db.query<{ status: string; error: string | null }>(
    "SELECT status, error FROM ops.run WHERE id = $1",
    [runId],
  );
  return rows[0] ?? { status: "absent", error: null };
}

async function waitsForTurn(runId: string): Promise<boolean> {
  const { rows } = await db.query(
    "SELECT 1 FROM ops.run_event WHERE run_id = $1 AND event = 'run_waiting'",
    [runId],
  );
  return rows.length > 0;
}

// ADR 0088: a build is a Python process and ~5 tenant connections; the worker started every
// build it was asked for at once.
describe("POST /v1/runs/transform, one build at a time", () => {
  withDatabase();

  beforeEach(async () => {
    await db.asSuperuser((tx) =>
      saveModel(tx, "CASE-2", {
        name: "stg_deals",
        sql: "select 1 as deal_id",
        tests: { columns: {} },
        updatedBy: "u-1",
      }),
    );
  });

  it("a second tenant's build waits in the ledger, and dbt starts it only once the first is done", async () => {
    const dbt = heldDbt();
    const app = api(dbt.spawn, db, { turns: { build: createSlots(1) } });

    const first = await post(app, "/v1/runs/transform", { tenantId: TENANT });
    await until(() => dbt.started() === 1);
    const second = await post(app, "/v1/runs/transform", { tenantId: "CASE-2" });
    expect(second.status).toBe(202);
    const { runId: waiting } = (await second.json()) as { runId: string };
    await until(() => waitsForTurn(waiting));
    expect(dbt.started()).toBe(1);

    dbt.release();
    await drainJobs();
    const { runId: held } = (await first.json()) as { runId: string };
    expect([(await runOf(held)).status, (await runOf(waiting)).status]).toEqual(["ok", "ok"]);
    expect(dbt.started()).toBe(2);
  });

  it("a build still waiting when the worker is told to stop never starts dbt, and its run says why", async () => {
    const dbt = heldDbt();
    const stop = new AbortController();
    const app = api(dbt.spawn, db, { turns: { build: createSlots(1) }, stop: stop.signal });

    await post(app, "/v1/runs/transform", { tenantId: TENANT });
    await until(() => dbt.started() === 1);
    const second = await post(app, "/v1/runs/transform", { tenantId: "CASE-2" });
    const { runId: waiting } = (await second.json()) as { runId: string };
    await until(() => waitsForTurn(waiting));

    stop.abort();
    await until(async () => (await runOf(waiting)).status === "failed");
    expect((await runOf(waiting)).error).toContain(
      "told to stop while this run waited for its turn",
    );
    expect(dbt.started()).toBe(1);
    dbt.release();
  });
});

// ADR 0088: the control plane reads only the status, so "busy" has to be a status of its own --
// before, it arrived as a 400 quoting the pooler's `query_wait_timeout` as if the SQL were wrong.
describe("POST /v1/queries/raw/run, the tenant's login busy", () => {
  withDatabase();

  it("answers 503 tenant_busy, not the author's query failing", async () => {
    await db.asSuperuser((tx) => provisionTenantRoles(tx, TENANT));
    const busy: TenantSessions = {
      as: () => Promise.reject(new TenantBusy()),
      withPassword: () => Promise.reject(new TenantBusy()),
    };
    const app = createLakeApi({
      lake: new LakeStore(new InMemoryObjectStore(), {
        stamps: createStampSource(new TestClock()),
      }),
      exec: db,
      serviceToken: "svc-token",
      dbt: {
        database: { host: "db.internal", port: 5432, dbname: "undercroft" },
        sessions: busy,
        workDir,
      },
    });

    const res = await post(app, "/v1/queries/raw/run", {
      tenantId: TENANT,
      sql: "select 1",
      limit: 10,
    });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe("tenant_busy");
  });
});

describe("POST /v1/dq/failures", () => {
  withDatabase();

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

describe("POST /v1/models/drop", () => {
  withDatabase();

  /** What exists in the tenant's two schemas, as `schema.name`. Read as the superuser. */
  async function relations(): Promise<string[]> {
    const { rows } = await db.asSuperuser((tx) =>
      tx.query<{ name: string }>(
        `SELECT n.nspname || '.' || c.relname AS name FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname IN ('analytics_case_1', 'dq_case_1') AND c.relkind IN ('r', 'v', 'm')
         ORDER BY 1`,
      ),
    );
    return rows.map((r) => r.name);
  }

  /** Relations as dbt leaves them: created by the tenant's own dbt login, which owns them. */
  async function built(sql: string): Promise<void> {
    await provisionTenantRoles(db, TENANT);
    await db.asRole("undercroft_dbt_case_1", (tx) => tx.exec(sql));
  }

  it("drops the built table and its tests' failing rows, so no login can read them", async () => {
    const app = api();
    await post(app, "/v1/models/build", { tenantId: TENANT, model: "stg_deals", triggeredBy: "" });
    expect(await relations()).toEqual([
      "analytics_case_1.stg_deals",
      "dq_case_1.not_null_stg_deals_deal_name",
    ]);

    const res = await post(app, "/v1/models/drop", { tenantId: TENANT, model: "stg_deals" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      dropped: [
        { schema: "analytics_case_1", name: "stg_deals", kind: "table" },
        { schema: "dq_case_1", name: "not_null_stg_deals_deal_name", kind: "table" },
      ],
    });
    expect(await relations()).toEqual([]);
  });

  it("a model never built drops nothing and succeeds, provisioned or not", async () => {
    const unprovisioned = await post(api(), "/v1/models/drop", {
      tenantId: TENANT,
      model: "stg_deals",
    });
    expect(unprovisioned.status).toBe(200);
    expect(await unprovisioned.json()).toEqual({ dropped: [] });

    await provisionTenantRoles(db, TENANT);
    const provisioned = await post(api(), "/v1/models/drop", {
      tenantId: TENANT,
      model: "stg_deals",
    });
    expect(await provisioned.json()).toEqual({ dropped: [] });
  });

  it("takes only its own: not a model whose name it prefixes, and a view as a view", async () => {
    await db.asSuperuser((tx) =>
      saveModel(tx, TENANT, {
        name: "stg",
        sql: "select 1 as id",
        tests: { columns: { id: ["not_null"] } },
        updatedBy: "u-1",
      }),
    );
    await built(`
      CREATE TABLE analytics_case_1.stg_deals AS SELECT 1 AS deal_id;
      CREATE VIEW analytics_case_1.stg AS SELECT 1 AS id;
      CREATE TABLE analytics_case_1.stg__dbt_backup AS SELECT 1 AS id;
      CREATE TABLE dq_case_1.not_null_stg_id AS SELECT NULL::int AS id;
      CREATE TABLE dq_case_1.unique_stg_email AS SELECT 'x' AS email;
      CREATE TABLE dq_case_1.unique_stg_deals_deal_id AS SELECT 1 AS deal_id;
      CREATE TABLE dq_case_1.not_null_stg_deals_deal_name AS SELECT 2 AS deal_id`);

    const res = await post(api(), "/v1/models/drop", { tenantId: TENANT, model: "stg" });
    expect(res.status).toBe(200);
    // Neither `unique_*` table is a declared test any more, so each is read by its name:
    // `unique_stg_email` is `stg`'s, and `unique_stg_deals_deal_id` the longer `stg_deals`'s.
    expect(await res.json()).toEqual({
      dropped: [
        { schema: "analytics_case_1", name: "stg", kind: "view" },
        { schema: "analytics_case_1", name: "stg__dbt_backup", kind: "table" },
        { schema: "dq_case_1", name: "not_null_stg_id", kind: "table" },
        { schema: "dq_case_1", name: "unique_stg_email", kind: "table" },
      ],
    });
    expect(await relations()).toEqual([
      "analytics_case_1.stg_deals",
      "dq_case_1.not_null_stg_deals_deal_name",
      "dq_case_1.unique_stg_deals_deal_id",
    ]);
  });

  it("refuses, dropping nothing, while another model's view reads from it", async () => {
    await built(`
      CREATE TABLE analytics_case_1.stg_deals AS SELECT 1 AS deal_id;
      CREATE TABLE dq_case_1.not_null_stg_deals_deal_name AS SELECT 2 AS deal_id;
      CREATE VIEW analytics_case_1.fct_pipeline AS SELECT deal_id FROM analytics_case_1.stg_deals`);

    const res = await post(api(), "/v1/models/drop", { tenantId: TENANT, model: "stg_deals" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: "relation_depended_on",
      details: ["fct_pipeline"],
    });
    expect(await relations()).toEqual([
      "analytics_case_1.fct_pipeline",
      "analytics_case_1.stg_deals",
      "dq_case_1.not_null_stg_deals_deal_name",
    ]);
  });

  it("refuses, dropping nothing, while a build of the tenant is running", async () => {
    await built("CREATE TABLE analytics_case_1.stg_deals AS SELECT 1 AS deal_id");
    await openRun(db, {
      id: "run-building",
      tenantId: TENANT,
      source: "*",
      verb: "transform",
      trigger: "schedule",
    });

    const res = await post(api(), "/v1/models/drop", { tenantId: TENANT, model: "stg_deals" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "run_in_progress", details: ["run-building"] });
    expect(await relations()).toEqual(["analytics_case_1.stg_deals"]);
  });
});

describe("a build refused before anything runs", () => {
  it("refuses a caller without the service token, and a body with no model", async () => {
    // `noDatabase` refuses every statement, so both refusals are also proven to come first.
    const app = api(fakeDbt, noDatabase);
    const body = { tenantId: TENANT, model: "stg_deals" };

    expect((await post(app, "/v1/models/build", body, "nope")).status).toBe(401);
    expect((await post(app, "/v1/models/build", { tenantId: TENANT })).status).toBe(400);
  });
});

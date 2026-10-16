/**
 * What a build promises: the project on disk is the tenant's own models with a profile that
 * IS the tenant, the password reaches dbt through its environment and no file, the directory
 * is gone afterwards, a build that ran is reported step by step, a build that could not run
 * raises with dbt's last lines, and a tenant with no models spawns nothing.
 *
 * dbt itself is not run: the spawn seam is a small fake dbt that does what the real one
 * would do to the database -- create the model's table AS THE TENANT'S ROLE -- and writes
 * the `run_results.json` the real one writes. PGlite proves the grants that lets it.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { byCodeUnit } from "@undercroft/core";
import { getModel, provisionScope, provisionTenantRoles, saveModel } from "@undercroft/db/repos";
import { PASSWORD_VAR } from "@undercroft/db/services";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";

import { sessionsBySetRole } from "./tenantSession.ts";
import { runTransform, type Spawn, type SpawnOptions, type TransformDeps } from "./transform.ts";

const TENANT = "CASE-1";
const DATABASE = { host: "db.internal", port: 5432, dbname: "undercroft" };
const EXITED_2 = /exited 2/u;

let db: TestDatabase;
let workDir: string;

/** What the fake dbt saw: the command, the directory, and every file in it at the time. */
interface Seen {
  cmd: readonly string[];
  options: SpawnOptions;
  files: Record<string, string>;
}

function readTree(dir: string, prefix = ""): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      Object.assign(files, readTree(join(dir, entry.name), rel));
    } else {
      files[rel] = readFileSync(join(dir, entry.name), "utf8");
    }
  }
  return files;
}

function writeResults(dir: string, results: unknown[]): void {
  mkdirSync(join(dir, "target"), { recursive: true });
  writeFileSync(join(dir, "target", "run_results.json"), JSON.stringify({ results }));
}

/** The manifest dbt writes beside its results: here, which model each test hangs off. */
function writeManifest(dir: string, attached: Record<string, string>): void {
  const nodes = Object.fromEntries(
    Object.entries(attached).map(([test, model]) => [test, { attached_node: model }]),
  );
  writeFileSync(join(dir, "target", "manifest.json"), JSON.stringify({ nodes }));
}

const MODEL_OK = {
  unique_id: "model.undercroft.stg_deals",
  status: "success",
  message: "CREATE TABLE",
  failures: null,
  execution_time: 0.2,
  relation_name: '"undercroft"."analytics_case_1"."stg_deals"',
};

function deps(spawn: Spawn): TransformDeps {
  return {
    exec: db,
    database: DATABASE,
    sessions: sessionsBySetRole(db, (role, fn) => db.asRole(role, fn)),
    env: { PATH: "/opt/dbt/bin" },
    spawn,
    workDir,
  };
}

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [TENANT]);
  await saveModel(db, TENANT, {
    name: "stg_deals",
    sql: "select 1 as deal_id",
    tests: { columns: { deal_id: ["not_null"] } },
    updatedBy: "u-1",
  });
  workDir = mkdtempSync(join(tmpdir(), "undercroft-transform-test-"));
  await db.become("undercroft_worker");
});

afterEach(async () => {
  await db.close();
});

/** The relations in one schema, by name, read as the superuser. */
async function relationsOf(schema: string): Promise<string[]> {
  const { rows } = await db.asSuperuser((tx) =>
    tx.query<{ name: string }>(
      `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relkind IN ('r', 'v', 'm') ORDER BY 1`,
      [schema],
    ),
  );
  return rows.map((r) => r.name);
}

describe("runTransform", () => {
  it("writes the tenant's project, passes the password by environment only, and cleans up", async () => {
    const seen: { last: Seen | null } = { last: null };
    const outcome = await runTransform(
      deps(async (cmd, options) => {
        seen.last = { cmd, options, files: readTree(options.cwd) };
        // What dbt would do, as the login dbt would be.
        await db.asRole("undercroft_dbt_case_1", (tx) =>
          tx.exec("CREATE TABLE staging_case_1.stg_deals AS SELECT 1 AS deal_id"),
        );
        writeResults(options.cwd, [MODEL_OK]);
        return { exitCode: 0, stdout: "Completed successfully", stderr: "" };
      }),
      { tenantId: TENANT },
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.steps.map((s) => [s.kind, s.name, s.status])).toEqual([
      ["model", "stg_deals", "success"],
    ]);
    const spawned = seen.last;
    if (spawned === null) {
      throw new Error("dbt was not spawned");
    }
    const { cmd: argv, options: spawnOptions, files } = spawned;
    expect(argv.slice(0, 2)).toEqual(["dbt", "build"]);
    expect(argv).toContain("--project-dir");
    expect(files["models/stg_deals.sql"]).toBe("select 1 as deal_id");
    expect(files["profiles.yml"]).toContain("user: undercroft_dbt_case_1");
    expect(files["profiles.yml"]).toContain("schema: staging_case_1");
    expect(files["models/schema.yml"]).toContain("        data_tests:\n          - not_null\n");
    // The password: in the child's environment, in no file, and the directory is gone.
    const password = spawnOptions.env[PASSWORD_VAR] ?? "";
    expect(password.length).toBeGreaterThan(20);
    for (const text of Object.values(files)) {
      expect(text).not.toContain(password);
    }
    expect(spawnOptions.env.PATH).toBe("/opt/dbt/bin");
    expect(existsSync(spawnOptions.cwd)).toBe(false);

    // What was built is recorded for the editor: the relation's columns, as the tenant saw them.
    const model = await getModel(db, TENANT, "stg_deals");
    expect(model?.columns).toEqual(["deal_id"]);
    // It had no test that failed, so it was published: moved out of staging into analytics.
    expect(outcome.steps[0]?.promoted).toBe(true);
    expect(await relationsOf("staging_case_1")).toEqual([]);
    expect(await relationsOf("analytics_case_1")).toEqual(["stg_deals"]);
  });

  it("a build that ran and broke a model is an outcome with dbt's own message, not a throw", async () => {
    const outcome = await runTransform(
      deps((_cmd, options) => {
        writeResults(options.cwd, [
          { ...MODEL_OK, status: "error", message: 'column "nope" does not exist' },
          {
            unique_id: "test.undercroft.not_null_stg_deals_deal_id.a1",
            status: "skipped",
            message: null,
            failures: null,
            execution_time: 0,
            relation_name: null,
          },
        ]);
        return Promise.resolve({
          exitCode: 1,
          stdout: "Database Error in model stg_deals",
          stderr: "",
        });
      }),
      { tenantId: TENANT },
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe('column "nope" does not exist');
    expect(outcome.steps).toHaveLength(2);
    expect((await getModel(db, TENANT, "stg_deals"))?.columns).toEqual([]);
  });

  it("a failing test is counted on an otherwise successful build", async () => {
    const outcome = await runTransform(
      deps(async (_cmd, options) => {
        await db.asRole("undercroft_dbt_case_1", (tx) =>
          tx.exec("CREATE TABLE staging_case_1.stg_deals AS SELECT 1 AS deal_id"),
        );
        writeResults(options.cwd, [
          MODEL_OK,
          {
            unique_id: "test.undercroft.not_null_stg_deals_deal_id.a1",
            status: "fail",
            message: "Got 3 results",
            failures: 3,
            execution_time: 0.1,
            relation_name: '"undercroft"."dq_case_1"."not_null_stg_deals_deal_id"',
          },
        ]);
        writeManifest(options.cwd, {
          "test.undercroft.not_null_stg_deals_deal_id.a1": "model.undercroft.stg_deals",
        });
        return { exitCode: 1, stdout: "Done. PASS=0 FAIL=1", stderr: "" };
      }),
      { tenantId: TENANT },
    );

    // The run is still ok -- the model built -- and the control plane reads its verdict as
    // tests-failing from this count (ADR 0129). The status is not changed here; what changed is
    // that the rows the test refused were not published (ADR 0131).
    expect(outcome.ok).toBe(true);
    expect(outcome.testsFailed).toBe(1);
    // The failing test is attributed to the model it tests, from the manifest (ADR 0129).
    expect(outcome.steps.map((s) => [s.kind, s.name, s.model ?? null, s.promoted ?? null])).toEqual(
      [
        ["model", "stg_deals", null, false],
        ["test", "not_null_stg_deals_deal_id", "stg_deals", null],
      ],
    );
  });

  it("dbt that could not run at all raises with its last lines, and the directory is still removed", async () => {
    const seen = { cwd: "" };
    await expect(
      runTransform(
        deps((_cmd, options) => {
          seen.cwd = options.cwd;
          return Promise.resolve({
            exitCode: 2,
            stdout: "Could not find profile named 'undercroft'",
            stderr: "",
          });
        }),
        { tenantId: TENANT },
      ),
    ).rejects.toThrow(EXITED_2);
    expect(existsSync(seen.cwd)).toBe(false);
  });

  it("dbt sees the tenant's macros, and none of the worker's secrets: a model's env_var() cannot read them", async () => {
    // A model or macro is the tenant's text, and `env_var()` reads the child's environment
    // into it. The worker's own holds the master key and its DSN (ADR 0086).
    await db.asSuperuser((tx) =>
      tx.query(
        "INSERT INTO app.macro (tenant_id, name, description, sql) VALUES ($1, $2, $3, $4)",
        [TENANT, "trimmed", "Trims a text.", "{% macro trimmed(x) %}btrim({{ x }}){% endmacro %}"],
      ),
    );
    const seen: { env: Readonly<Record<string, string>>; files: Record<string, string> } = {
      env: {},
      files: {},
    };
    await runTransform(
      {
        ...deps((_cmd, options) => {
          seen.env = options.env;
          seen.files = readTree(options.cwd);
          writeResults(options.cwd, []);
          return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
        }),
        env: {
          PATH: "/opt/dbt/bin",
          UNDERCROFT_SECRET_KEY: "master-key-material",
          UNDERCROFT_POSTGRES_DSN: "postgres://undercroft_worker:pw@db/undercroft",
        },
      },
      { tenantId: TENANT },
    );

    expect(seen.files["macros/tenant/trimmed.sql"]).toContain("{% macro trimmed(x) %}");
    expect(Object.keys(seen.env).sort(byCodeUnit)).toEqual([PASSWORD_VAR, "PATH"].sort(byCodeUnit));
    expect(seen.env.PATH).toBe("/opt/dbt/bin");
    expect(Object.values(seen.env).join("\n")).not.toContain("master-key-material");
  });

  it("a tenant with no models spawns nothing and reports an empty build", async () => {
    await db.asSuperuser((tx) => tx.query("INSERT INTO ops.tenant (id) VALUES ('CASE-2')"));
    let spawned = 0;
    const outcome = await runTransform(
      deps(() => {
        spawned += 1;
        return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
      }),
      { tenantId: "CASE-2" },
    );
    expect(spawned).toBe(0);
    // `models: 0` is the difference between "nothing to build" and "a build that found
    // nothing", which the journal turns into two different sentences on the screen.
    expect(outcome).toEqual({ ok: true, steps: [], testsFailed: 0, error: null, models: 0 });
  });
});

describe("runTransform, with the tenant's seeds (ADR 0128)", () => {
  const SEED_OK = {
    unique_id: "seed.undercroft.account_groups",
    status: "success",
    message: "INSERT 2",
    failures: null,
    execution_time: 0.1,
    relation_name: '"undercroft"."analytics_case_1"."account_groups"',
  };

  async function plantSeed(tenantId = TENANT): Promise<void> {
    await db.asSuperuser((tx) =>
      tx.query("INSERT INTO app.seed (tenant_id, name, columns, rows) VALUES ($1, $2, $3, $4)", [
        tenantId,
        "account_groups",
        JSON.stringify([
          { name: "code", type: "text" },
          { name: "budget", type: "numeric(18,4)" },
        ]),
        JSON.stringify([
          ["0511", "12345678901234.5678"],
          ["642", null],
        ]),
      ]),
    );
  }

  /** A build that records what dbt was handed and answers with `results`. */
  function recording(seen: { last: Seen | null }, results: unknown[], exitCode = 0): Spawn {
    return (cmd, options) => {
      seen.last = { cmd, options, files: readTree(options.cwd) };
      writeResults(options.cwd, results);
      return Promise.resolve({ exitCode, stdout: "", stderr: "" });
    };
  }

  it("renders each seed as its CSV with every column typed, and records its load as a step", async () => {
    await plantSeed();
    const seen: { last: Seen | null } = { last: null };

    const outcome = await runTransform(deps(recording(seen, [SEED_OK, MODEL_OK])), {
      tenantId: TENANT,
      select: ["stg_deals", "+fct_pipeline", "dim_owner+"],
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.steps.map((s) => [s.kind, s.name, s.status])).toEqual([
      ["seed", "account_groups", "success"],
      ["model", "stg_deals", "success"],
    ]);
    const files = seen.last?.files ?? {};
    // The amount is the text it was stored as, quoted; the NULL is the one unquoted empty field.
    expect(files["seeds/account_groups.csv"]).toBe(
      'code,budget\n"0511","12345678901234.5678"\n"642",\n',
    );
    expect(files["dbt_project.yml"]).toContain(
      '    "account_groups":\n      +column_types:\n        "code": "text"\n        "budget": "numeric(18,4)"\n',
    );
    // A seed never loaded has no table to compare, so it is created by its first load.
    expect(files["dbt_project.yml"]).not.toContain("+full_refresh");
    // Each selector brings the seeds it reaches, or a model would read a seed nothing loaded.
    const argv = seen.last?.cmd ?? [];
    expect(argv.slice(argv.indexOf("--select") + 1)).toEqual([
      "stg_deals",
      "+fct_pipeline",
      "dim_owner+",
      "1+stg_deals,resource_type:seed",
      "+fct_pipeline,resource_type:seed",
      "@dim_owner,resource_type:seed",
    ]);
  });

  it("a seed that did not load fails the build in dbt's words, though no model broke", async () => {
    await plantSeed();

    const outcome = await runTransform(
      deps(
        recording(
          { last: null },
          [
            { ...SEED_OK, status: "error", message: 'invalid input syntax for type numeric: "x"' },
            { ...MODEL_OK, status: "skipped", message: null },
          ],
          1,
        ),
      ),
      { tenantId: TENANT },
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe('invalid input syntax for type numeric: "x"');
  });

  it("a tenant with seeds and no models still builds, loading them", async () => {
    await db.asSuperuser((tx) => tx.query("INSERT INTO ops.tenant (id) VALUES ('CASE-2')"));
    await plantSeed("CASE-2");
    const seen: { last: Seen | null } = { last: null };

    const outcome = await runTransform(deps(recording(seen, [SEED_OK])), { tenantId: "CASE-2" });

    expect(seen.last).not.toBeNull();
    expect(outcome.steps.map((s) => s.kind)).toEqual(["seed"]);
  });

  it("reloads a seed from scratch only when its standing table no longer has the declared columns", async () => {
    await plantSeed();
    async function yml(): Promise<string> {
      const seen: { last: Seen | null } = { last: null };
      // A load that errored is held, so the table standing in staging stays for the next build.
      await runTransform(deps(recording(seen, [{ ...SEED_OK, status: "error" }])), {
        tenantId: TENANT,
      });
      return seen.last?.files["dbt_project.yml"] ?? "";
    }
    // The first build provisions the tenant's login; its load made the table, as that login.
    expect(await yml()).not.toContain("+full_refresh");
    // A load held back stays in staging, where the next build loads again (ADR 0131).
    await db.asRole("undercroft_dbt_case_1", (tx) =>
      tx.exec("CREATE TABLE staging_case_1.account_groups (code text, budget numeric(18,4))"),
    );
    const matching = await yml();
    // The declaration changed since: `budget` was text, so a truncate-and-insert would cast every
    // amount into the old type.
    await db.asRole("undercroft_dbt_case_1", (tx) =>
      tx.exec("ALTER TABLE staging_case_1.account_groups ALTER COLUMN budget TYPE text"),
    );
    const changed = await yml();

    expect(matching).not.toContain("+full_refresh");
    expect(changed).toContain('    "account_groups":\n');
    expect(changed).toContain("      +full_refresh: true\n");
  });
});

// ADR 0131 (issue 459): a build writes into staging, and only what passed reaches the schema the
// BI login reads. A model whose new build fails keeps serving its last passing version.
describe("runTransform, write-audit-publish", () => {
  const PARENT_OK = MODEL_OK;
  const CHILD_OK = {
    ...MODEL_OK,
    unique_id: "model.undercroft.fct_pipeline",
    relation_name: '"undercroft"."staging_case_1"."fct_pipeline"',
  };
  const TEST = "test.undercroft.not_null_stg_deals_deal_id.a1";

  function testResult(status: "pass" | "fail") {
    return {
      unique_id: TEST,
      status,
      message: status === "fail" ? "Got 1 result" : null,
      failures: status === "fail" ? 1 : 0,
      execution_time: 0.1,
      relation_name: null,
    };
  }

  /** dbt's manifest: the test hangs off stg_deals, and fct_pipeline reads stg_deals. */
  function writeGraph(dir: string): void {
    writeFileSync(
      join(dir, "target", "manifest.json"),
      JSON.stringify({
        nodes: {
          [TEST]: { attached_node: "model.undercroft.stg_deals" },
          "model.undercroft.stg_deals": { depends_on: { nodes: [] } },
          "model.undercroft.fct_pipeline": {
            depends_on: { nodes: ["model.undercroft.stg_deals"] },
          },
        },
      }),
    );
  }

  /** A dbt that runs `sql` as the tenant's dbt login and reports `results`. */
  function dbtThat(sql: string, results: unknown[]): Spawn {
    return async (_cmd, options) => {
      await db.asRole("undercroft_dbt_case_1", (tx) => tx.exec(sql));
      writeResults(options.cwd, results);
      writeGraph(options.cwd);
      return { exitCode: 0, stdout: "", stderr: "" };
    };
  }

  /** What the BI login -- every dashboard -- reads of a published relation. */
  async function biReads(relation: string): Promise<unknown[]> {
    const { rows } = await db.asRole("undercroft_bi_case_1", (tx) =>
      tx.query<{ deal_id: number | null }>(`SELECT deal_id FROM analytics_case_1.${relation}`),
    );
    return rows.map((r) => r.deal_id);
  }

  beforeEach(async () => {
    await db.asSuperuser((tx) => provisionTenantRoles(tx, TENANT));
    await db.asSuperuser((tx) =>
      saveModel(tx, TENANT, {
        name: "fct_pipeline",
        sql: "select * from {{ ref('stg_deals') }}",
        tests: { columns: {} },
        updatedBy: "u-1",
      }),
    );
  });

  it("a build whose tests fail keeps the last passing rows published; its own wait in staging", async () => {
    await runTransform(
      deps(
        dbtThat("CREATE TABLE staging_case_1.stg_deals AS SELECT 1 AS deal_id", [
          PARENT_OK,
          testResult("pass"),
        ]),
      ),
      { tenantId: TENANT, select: ["stg_deals"] },
    );
    expect(await biReads("stg_deals")).toEqual([1]);

    const failing = await runTransform(
      deps(
        dbtThat("CREATE TABLE staging_case_1.stg_deals AS SELECT NULL::int AS deal_id", [
          PARENT_OK,
          testResult("fail"),
        ]),
      ),
      { tenantId: TENANT, select: ["stg_deals"] },
    );

    expect(failing.steps.find((s) => s.kind === "model")?.promoted).toBe(false);
    expect(await biReads("stg_deals")).toEqual([1]);
    expect(await relationsOf("staging_case_1")).toEqual(["stg_deals"]);
    // The BI login cannot reach the rows that failed: it has no USAGE on staging.
    await expect(
      db.asRole("undercroft_bi_case_1", (tx) => tx.query("SELECT * FROM staging_case_1.stg_deals")),
    ).rejects.toThrow("permission denied");
  });

  it("a first build that fails its tests publishes nothing at all", async () => {
    const outcome = await runTransform(
      deps(
        dbtThat("CREATE TABLE staging_case_1.stg_deals AS SELECT NULL::int AS deal_id", [
          PARENT_OK,
          testResult("fail"),
        ]),
      ),
      { tenantId: TENANT, select: ["stg_deals"] },
    );

    expect(outcome.steps.find((s) => s.kind === "model")?.promoted).toBe(false);
    expect(await relationsOf("analytics_case_1")).toEqual([]);
  });

  it("a child built over a parent that was held is held with it, and both keep their old versions", async () => {
    // Published before: the parent, and another model's view that reads it from outside the build.
    await db.asRole("undercroft_dbt_case_1", (tx) =>
      tx.exec(`CREATE TABLE analytics_case_1.stg_deals AS SELECT 1 AS deal_id;
               CREATE TABLE analytics_case_1.fct_pipeline AS SELECT 1 AS deal_id;
               CREATE VIEW analytics_case_1.v_deals AS SELECT deal_id FROM analytics_case_1.stg_deals`),
    );

    const outcome = await runTransform(
      deps(
        dbtThat(
          `CREATE TABLE staging_case_1.stg_deals AS SELECT 2 AS deal_id;
           CREATE TABLE staging_case_1.fct_pipeline AS SELECT * FROM staging_case_1.stg_deals`,
          [PARENT_OK, testResult("pass"), CHILD_OK],
        ),
      ),
      { tenantId: TENANT, select: ["stg_deals+"] },
    );

    // The parent passed its tests, but dropping its published version would take the view with
    // it: it is held, and the child, built from its staging rows, is held too.
    expect(
      outcome.steps.filter((s) => s.kind === "model").map((s) => [s.name, s.promoted]),
    ).toEqual([
      ["stg_deals", false],
      ["fct_pipeline", false],
    ]);
    expect(outcome.heldByViews).toEqual(new Map([["stg_deals", ["v_deals"]]]));
    expect(await biReads("stg_deals")).toEqual([1]);
    expect(await biReads("fct_pipeline")).toEqual([1]);
  });

  // ADR 0142: a scope login is granted the staged table inside the promotion, before it moves, so
  // a republished table is readable by exactly the scopes that reach it, with no moment between.
  it("a republished table keeps its scope's grant, and a scope that does not reach it gets none", async () => {
    const deals = await db.asSuperuser((tx) => provisionScope(tx, TENANT, ["stg_deals"]));
    const pipeline = await db.asSuperuser((tx) => provisionScope(tx, TENANT, ["fct_pipeline"]));
    function build(n: number) {
      return runTransform(
        deps(
          dbtThat(`CREATE TABLE staging_case_1.stg_deals AS SELECT ${String(n)} AS deal_id`, [
            PARENT_OK,
            testResult("pass"),
          ]),
        ),
        { tenantId: TENANT, select: ["stg_deals"] },
      );
    }
    function reads(login: string) {
      return db.asRole(login, (tx) =>
        tx.query<{ deal_id: number }>("SELECT deal_id FROM analytics_case_1.stg_deals"),
      );
    }

    await build(1);
    const first = await reads(deals);
    await build(2);
    const second = await reads(deals);

    expect([first.rows, second.rows]).toEqual([[{ deal_id: 1 }], [{ deal_id: 2 }]]);
    await expect(reads(pipeline)).rejects.toThrow("permission denied");
  });

  it("a view promoted with the table it reads replaces both, and BI reads the new rows through it", async () => {
    await db.asRole("undercroft_dbt_case_1", (tx) =>
      tx.exec(`CREATE TABLE analytics_case_1.stg_deals AS SELECT 1 AS deal_id;
               CREATE VIEW analytics_case_1.fct_pipeline AS
                 SELECT deal_id FROM analytics_case_1.stg_deals`),
    );

    const outcome = await runTransform(
      deps(
        dbtThat(
          `CREATE TABLE staging_case_1.stg_deals AS SELECT 2 AS deal_id;
           CREATE VIEW staging_case_1.fct_pipeline AS SELECT deal_id FROM staging_case_1.stg_deals`,
          [PARENT_OK, testResult("pass"), CHILD_OK],
        ),
      ),
      { tenantId: TENANT, select: ["stg_deals+"] },
    );

    expect(outcome.steps.filter((s) => s.promoted === true).map((s) => s.name)).toEqual([
      "stg_deals",
      "fct_pipeline",
    ]);
    expect(await biReads("fct_pipeline")).toEqual([2]);
    expect(await relationsOf("staging_case_1")).toEqual([]);
  });
});

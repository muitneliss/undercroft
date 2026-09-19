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

// biome-ignore-all lint/correctness/noNodejsModules: A test that inspects the directory the code under test wrote; the platform is Bun.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useNamingConvention: `run_results`, `unique_id` and `relation_name` are dbt's own names, written to the file dbt owns.

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
import { migrate } from "@undercroft/db";
import { getModel, saveModel } from "@undercroft/db/repos";
import { PASSWORD_VAR } from "@undercroft/db/services";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";

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
  db = await createTestDatabase();
  await migrate(db);
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

describe("runTransform", () => {
  it("writes the tenant's project, passes the password by environment only, and cleans up", async () => {
    const seen: { last: Seen | null } = { last: null };
    const outcome = await runTransform(
      deps(async (cmd, options) => {
        seen.last = { cmd, options, files: readTree(options.cwd) };
        // What dbt would do, as the login dbt would be.
        await db.asRole("undercroft_dbt_case_1", (tx) =>
          tx.exec("CREATE TABLE analytics_case_1.stg_deals AS SELECT 1 AS deal_id"),
        );
        writeResults(options.cwd, [MODEL_OK]);
        return { exitCode: 0, output: "Completed successfully" };
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
    expect(files["profiles.yml"]).toContain("schema: analytics_case_1");
    expect(files["models/schema.yml"]).toContain("data_tests: [not_null]");
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
        return Promise.resolve({ exitCode: 1, output: "Database Error in model stg_deals" });
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
          tx.exec("CREATE TABLE analytics_case_1.stg_deals AS SELECT 1 AS deal_id"),
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
        return { exitCode: 1, output: "Done. PASS=0 FAIL=1" };
      }),
      { tenantId: TENANT },
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.testsFailed).toBe(1);
  });

  it("dbt that could not run at all raises with its last lines, and the directory is still removed", async () => {
    const seen = { cwd: "" };
    await expect(
      runTransform(
        deps((_cmd, options) => {
          seen.cwd = options.cwd;
          return Promise.resolve({
            exitCode: 2,
            output: "Could not find profile named 'undercroft'",
          });
        }),
        { tenantId: TENANT },
      ),
    ).rejects.toThrow(EXITED_2);
    expect(existsSync(seen.cwd)).toBe(false);
  });

  it("a tenant with no models spawns nothing and reports an empty build", async () => {
    await db.asSuperuser((tx) => tx.query("INSERT INTO ops.tenant (id) VALUES ('CASE-2')"));
    let spawned = 0;
    const outcome = await runTransform(
      deps(() => {
        spawned += 1;
        return Promise.resolve({ exitCode: 0, output: "" });
      }),
      { tenantId: "CASE-2" },
    );
    expect(spawned).toBe(0);
    // `models: 0` is the difference between "nothing to build" and "a build that found
    // nothing", which the journal turns into two different sentences on the screen.
    expect(outcome).toEqual({ ok: true, steps: [], testsFailed: 0, error: null, models: 0 });
  });
});

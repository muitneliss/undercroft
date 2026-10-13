/**
 * What a model preview promises (ADR 0132): dbt compiles the DRAFT, not the saved model of its
 * name; the child holds no password and none of the worker's secrets; what dbt compiled runs as
 * the tenant's dbt login inside the read-only frame, alone or under an outer query that names the
 * model; and a compile dbt refused is a refusal carrying dbt's own cause.
 *
 * dbt itself is not run. The spawn seam is a small fake dbt that does what `dbt compile` does to
 * the project directory: it reads the model's file and writes the manifest's `compiled_code`,
 * resolving each `ref()` to the published schema as the platform's `ref` override does. PGlite
 * runs what it compiled, with the tenant's real grants.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveModel } from "@undercroft/db/repos";
import { PASSWORD_VAR } from "@undercroft/db/services";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";

import { ModelCompileFailed, type PreviewDeps, previewModel } from "./modelPreview.ts";
import { QueryFailed } from "./queryRunner.ts";
import { sessionsBySetRole } from "./tenantSession.ts";
import type { Spawn, SpawnOptions } from "./transform.ts";

const TENANT = "CASE-1";
const SAVED_SQL = "select 1 as deal_id";
/** A model that reads the published `base`, and ends in a comment as compiled code can. */
const DRAFT_SQL =
  "select deal_id, amount from {{ ref('base') }} order by deal_id, amount nulls first -- every deal";
const REF = /\{\{\s*ref\('(?<model>\w+)'\)\s*\}\}/gu;

let db: TestDatabase;
let workDir: string;

/** What the fake dbt was handed: its argv, its environment, and the project's model files. */
interface Compiled {
  readonly cmd: readonly string[];
  readonly env: SpawnOptions["env"];
  readonly models: Record<string, string>;
}

/** `dbt compile`, as far as the project directory can tell. Records what it was handed. */
function fakeDbt(seen: Compiled[]): Spawn {
  return (cmd, options) => {
    const name = cmd[cmd.indexOf("--select") + 1] ?? "";
    const dir = join(options.cwd, "models");
    const models = Object.fromEntries(
      readdirSync(dir)
        .filter((file) => file.endsWith(".sql"))
        .map((file) => [file, readFileSync(join(dir, file), "utf8")]),
    );
    seen.push({ cmd, env: options.env, models });
    const compiled = (models[`${name}.sql`] ?? "").replaceAll(REF, '"analytics_case_1"."$<model>"');
    mkdirSync(join(options.cwd, "target"), { recursive: true });
    writeFileSync(
      join(options.cwd, "target", "manifest.json"),
      JSON.stringify({ nodes: { [`model.undercroft.${name}`]: { compiled_code: compiled } } }),
    );
    return Promise.resolve({ exitCode: 0, stdout: "Done.", stderr: "" });
  };
}

function deps(spawn: Spawn): PreviewDeps {
  return {
    exec: db,
    database: { host: "db.internal", port: 5432, dbname: "undercroft" },
    sessions: sessionsBySetRole(db, (role, fn) => db.asRole(role, fn)),
    // A secret the worker holds, which a model's `env_var()` must never be able to read.
    env: { PATH: "/opt/dbt/bin", UNDERCROFT_SECRET_KEY: "not-for-dbt" },
    spawn,
    workDir,
  };
}

async function refusedWith(fn: () => Promise<unknown>): Promise<Error> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the preview to be refused");
}

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [TENANT]);
  await db.query("SELECT ops.provision_tenant($1)", [TENANT]);
  // A parent's published version, as a build would have left it, as the login that built it.
  await db.asRole("undercroft_dbt_case_1", (tx) =>
    tx.exec(`CREATE TABLE analytics_case_1.base AS
      SELECT 1 AS deal_id, 12345678901234.5678::numeric(18,4) AS amount
      UNION ALL SELECT 2, NULL
      UNION ALL SELECT 2, 10.0000;
      CREATE SEQUENCE analytics_case_1.counter`),
  );
  await saveModel(db, TENANT, {
    name: "stg_deals",
    sql: SAVED_SQL,
    tests: { columns: { deal_id: ["not_null"] } },
    updatedBy: "u-1",
  });
  workDir = mkdtempSync(join(tmpdir(), "undercroft-preview-test-"));
  await db.become("undercroft_worker");
});

afterEach(async () => {
  await db.close();
});

describe("previewModel", () => {
  it("compiles the draft in place of the saved model, and answers a sample with what dbt compiled", async () => {
    const seen: Compiled[] = [];
    const preview = await previewModel(deps(fakeDbt(seen)), {
      tenantId: TENANT,
      name: "stg_deals",
      sql: DRAFT_SQL,
      limit: 2,
    });

    const [compiled] = seen;
    expect(compiled?.cmd.slice(0, 2)).toEqual(["dbt", "compile"]);
    expect(compiled?.cmd).toContain("--no-introspect");
    expect(compiled?.models).toEqual({ "stg_deals.sql": DRAFT_SQL });
    expect(preview.compiled).toBe(
      'select deal_id, amount from "analytics_case_1"."base" order by deal_id, amount nulls first -- every deal',
    );
    expect(preview.columns).toEqual([
      { name: "deal_id", type: "integer" },
      { name: "amount", type: "numeric" },
    ]);
    expect(preview.rows).toEqual([
      [1, "12345678901234.5678"],
      [2, null],
    ]);
    expect(preview.truncated).toBe(true);
  });

  it("answers an outer query over the model, which it names, beside the saved models", async () => {
    const seen: Compiled[] = [];
    const preview = await previewModel(deps(fakeDbt(seen)), {
      tenantId: TENANT,
      name: "fct_deals",
      sql: DRAFT_SQL,
      query: "select count(*)::int as n, count(distinct deal_id)::int as k from fct_deals;",
      limit: 10,
    });

    expect(Object.keys(seen[0]?.models ?? {}).sort()).toEqual(["fct_deals.sql", "stg_deals.sql"]);
    expect(preview.rows).toEqual([[3, 2]]);
    expect(preview.truncated).toBe(false);
  });

  it("runs as the tenant's dbt login in a read-only frame, so an outer query cannot write", async () => {
    const input = { tenantId: TENANT, name: "fct_deals", sql: DRAFT_SQL, limit: 10 };
    const login = await previewModel(deps(fakeDbt([])), {
      ...input,
      query: "select distinct current_user as login from fct_deals",
    });
    expect(login.rows).toEqual([["undercroft_dbt_case_1"]]);

    // The login owns this sequence; only the frame's READ ONLY stops the write.
    const refused = await refusedWith(() =>
      previewModel(deps(fakeDbt([])), {
        ...input,
        query: "select nextval('analytics_case_1.counter') from fct_deals",
      }),
    );
    expect(refused).toBeInstanceOf(QueryFailed);
    expect(refused.message).toContain("read-only transaction");
  });

  it("a compile dbt refused, leaving no manifest, is compile-failed with dbt's own cause", async () => {
    const stopped: Spawn = () =>
      Promise.resolve({
        exitCode: 2,
        stdout: [
          "11:09:28  Running with dbt=1.9.1",
          "11:09:29  Registered adapter: postgres=1.9.0",
          "11:09:31  Encountered an error:",
          "Compilation Error in model base2 (models/base2.sql)",
          "  'oops' is undefined",
        ].join("\n"),
        stderr: "",
      });

    const refused = await refusedWith(() =>
      previewModel(deps(stopped), {
        tenantId: TENANT,
        name: "stg_deals",
        sql: DRAFT_SQL,
        limit: 10,
      }),
    );

    expect(refused).toBeInstanceOf(ModelCompileFailed);
    expect(refused.message).toBe(
      "Encountered an error:\nCompilation Error in model base2 (models/base2.sql)\n'oops' is undefined",
    );
  });

  it("hands dbt no password and none of the worker's secrets: compiling cannot log in", async () => {
    const seen: Compiled[] = [];
    await previewModel(deps(fakeDbt(seen)), {
      tenantId: TENANT,
      name: "stg_deals",
      sql: DRAFT_SQL,
      limit: 1,
    });

    expect(seen[0]?.env).toEqual({ PATH: "/opt/dbt/bin", [PASSWORD_VAR]: "" });
  });
});

/**
 * What the generated project promises: the profile logs in as the tenant and writes to the
 * tenant's schema, the password is read from the environment and appears in no file, the
 * chosen tests become dbt's schema file, and dbt's results become the ledger's steps with
 * the failing tests counted.
 */

// biome-ignore-all lint/style/useNamingConvention: `not_null`, `unique_id` and `relation_name` are dbt's own names, read from and written to files dbt owns.

import { describe, expect, test as it } from "bun:test";

import { MACROS, parseRunResults, PASSWORD_VAR, renderProject } from "./dbtProject.ts";

/** A `password:` line whose value is a literal rather than a template or a quoted template. */
const LITERAL_PASSWORD = /password: [^"{]/u;

const PROJECT = renderProject({
  slug: "case_0042",
  database: { host: "undercroft-postgres", port: 5432, dbname: "undercroft" },
  models: [
    {
      name: "stg_deals",
      sql: "select 1 as deal_id",
      tests: { columns: { deal_id: ["not_null", "unique"] } },
    },
    { name: "stg_contacts", sql: "select 2 as contact_id", tests: { columns: {} } },
  ],
});

describe("renderProject", () => {
  it("logs in as the tenant's own role and writes to the tenant's own schemas", () => {
    expect(PROJECT["profiles.yml"]).toContain("user: undercroft_dbt_case_0042");
    expect(PROJECT["profiles.yml"]).toContain("schema: analytics_case_0042");
    expect(PROJECT["dbt_project.yml"]).toContain("+schema: dq_case_0042");
    expect(PROJECT["macros/generate_schema_name.sql"]).toContain("custom_schema_name | trim");
  });

  it("reads the password from the environment; no file carries it", () => {
    expect(PROJECT["profiles.yml"]).toContain(`env_var('${PASSWORD_VAR}')`);
    for (const text of Object.values(PROJECT)) {
      expect(text).not.toMatch(LITERAL_PASSWORD);
    }
  });

  it("writes one file per model and the chosen tests as dbt's schema file", () => {
    expect(PROJECT["models/stg_deals.sql"]).toBe("select 1 as deal_id");
    expect(PROJECT["models/stg_contacts.sql"]).toBe("select 2 as contact_id");
    expect(PROJECT["models/schema.yml"]).toContain("- name: stg_deals");
    expect(PROJECT["models/schema.yml"]).toContain("data_tests: [not_null, unique]");
    // A model with no tests is not listed: an empty entry is a warning in dbt's eyes.
    expect(PROJECT["models/schema.yml"]).not.toContain("stg_contacts");
    for (const macro of MACROS) {
      expect(PROJECT[`macros/${macro.name}.sql`]).toBe(macro.sql);
    }
  });
});

describe("parseRunResults", () => {
  it("one step per model or test, with the failing tests counted", () => {
    const parsed = parseRunResults({
      results: [
        {
          unique_id: "model.undercroft.stg_deals",
          status: "success",
          message: "CREATE TABLE (3.0 rows, 0 processed)",
          failures: null,
          execution_time: 0.4321,
          relation_name: '"undercroft"."analytics_case_0042"."stg_deals"',
        },
        {
          unique_id: "test.undercroft.not_null_stg_deals_deal_id.a1b2c3",
          status: "fail",
          message: "Got 2 results, configured to fail if != 0",
          failures: 2,
          execution_time: 0.1,
          relation_name: '"undercroft"."dq_case_0042"."not_null_stg_deals_deal_id"',
        },
        {
          unique_id: "test.undercroft.unique_stg_deals_deal_id.d4e5",
          status: "pass",
          message: null,
          failures: 0,
          execution_time: 0.05,
          relation_name: null,
        },
        { unique_id: "seed.undercroft.rates", status: "success" },
        { not: "a node" },
      ],
    });

    expect(parsed.testsFailed).toBe(1);
    expect(parsed.steps.map((s) => [s.kind, s.name, s.status, s.failures, s.executionMs])).toEqual([
      ["model", "stg_deals", "success", null, 432],
      ["test", "not_null_stg_deals_deal_id", "fail", 2, 100],
      ["test", "unique_stg_deals_deal_id", "pass", 0, 50],
    ]);
  });

  it("something that is not dbt's file yields no steps rather than a guess", () => {
    expect(parseRunResults("garbage")).toEqual({ steps: [], testsFailed: 0 });
    expect(parseRunResults({ results: "no" })).toEqual({ steps: [], testsFailed: 0 });
  });
});

/**
 * What the generated project promises: the profile logs in as the tenant and writes to the
 * tenant's schema, the password is read from the environment and appears in no file, the
 * chosen tests become dbt's schema file, and dbt's results become the ledger's steps with
 * the failing tests counted. And what a model's build leaves behind is named exactly as dbt
 * names it, so a model's delete finds it.
 */

import { describe, expect, test as it } from "bun:test";

import {
  excelSerialDateSql,
  excelSerialTimestampSql,
  gmailLettersSql,
  MACROS,
  parseRunResults,
  PASSWORD_VAR,
  relationsOfModel,
  renderProject,
} from "./dbtProject.ts";

/** A `password:` line whose value is a literal rather than a template or a quoted template. */
const LITERAL_PASSWORD = /password: [^"{]/u;

/** Any Jinja delimiter: an expression, a statement or a comment. */
const JINJA = /\{[{%#]/u;

/** A file that is one Jinja comment and nothing else. */
const ONLY_A_COMMENT = /^\{#[^#]*#\}\n$/u;

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
  macros: [{ name: "trimmed", sql: "{% macro trimmed(x) %}btrim({{ x }}){% endmacro %}" }],
  seeds: [],
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
    expect(PROJECT["models/schema.yml"]).toContain(
      "        data_tests:\n          - not_null\n          - unique\n",
    );
    // A model with no tests is not listed: an empty entry is a warning in dbt's eyes.
    expect(PROJECT["models/schema.yml"]).not.toContain("stg_contacts");
    for (const macro of MACROS) {
      expect(PROJECT[`macros/${macro.name}.sql`]).toBe(macro.sql);
    }
  });

  it("writes each of the tenant's macros whole, in a directory apart from the platform's", () => {
    expect(PROJECT["macros/tenant/trimmed.sql"]).toBe(
      "{% macro trimmed(x) %}btrim({{ x }}){% endmacro %}",
    );
    expect(PROJECT["macros/trimmed.sql"]).toBeUndefined();
  });

  it("ships gmail_letters as exactly the SQL the offline suite runs, over dbt's source", () => {
    // gmailLetters.test.ts runs gmailLettersSql("raw.records") on PGlite. That proves the
    // shipped macro only while the macro is that same text with the relation swapped and a
    // docstring before it -- no Jinja of its own that the suite would never execute.
    const wrapped = `{% macro gmail_letters() %}\n${gmailLettersSql("{{ source('undercroft', 'records') }}")}\n{% endmacro %}\n`;
    const file = PROJECT["macros/gmail_letters.sql"] ?? "";
    expect(file.endsWith(wrapped)).toBe(true);
    expect(file.slice(0, file.length - wrapped.length)).toMatch(ONLY_A_COMMENT);
    expect(gmailLettersSql("raw.records")).not.toMatch(JINJA);
  });
});

describe("renderProject, the tests beyond not_null and unique (ADR 0130)", () => {
  const RICH = renderProject({
    slug: "case_0042",
    database: { host: "undercroft-postgres", port: 5432, dbname: "undercroft" },
    models: [
      {
        name: "stg_payments",
        sql: "select 1 as invoice_id",
        tests: {
          columns: {
            status: [{ kind: "accepted_values", values: ["open", "it's paid"], severity: "warn" }],
            code: [{ kind: "accepted_values", values: ["1", "2"], quote: false }],
            invoice_id: [
              { kind: "not_null", severity: "warn" },
              { kind: "relationships", to: "stg_invoices", field: "invoice_id" },
            ],
          },
          sql: [
            {
              name: "paid_not_after_received",
              sql: "select * from {{ ref('stg_payments') }} where paid_on > received_on",
              severity: "warn",
            },
            { name: "total_matches", sql: "select * from {{ ref('stg_payments') }} where false" },
          ],
        },
      },
    ],
    macros: [],
  });

  it("writes accepted_values and relationships in dbt 1.9's top-level form, severity under config", () => {
    expect(RICH["models/schema.yml"]).toContain(`      - name: status
        data_tests:
          - accepted_values:
              values: ["open", "it''s paid"]
              config:
                severity: warn
      - name: code
        data_tests:
          - accepted_values:
              values: ["1", "2"]
              quote: false
      - name: invoice_id
        data_tests:
          - not_null:
              config:
                severity: warn
          - relationships:
              to: "ref('stg_invoices')"
              field: invoice_id
`);
    // 1.10.5's `arguments:` would be read by 1.9 as one argument named `arguments`.
    expect(RICH["models/schema.yml"]).not.toContain("arguments:");
  });

  it("writes each SQL test as a singular test under tests/, a warn one saying so in its config", () => {
    expect(RICH["dbt_project.yml"]).toContain('test-paths: ["tests"]');
    expect(RICH["tests/stg_payments__paid_not_after_received.sql"]).toBe(
      "{{ config(severity = 'warn') }}\nselect * from {{ ref('stg_payments') }} where paid_on > received_on\n",
    );
    expect(RICH["tests/stg_payments__total_matches.sql"]).toBe(
      "select * from {{ ref('stg_payments') }} where false\n",
    );
    // Its failing rows go where every test's go: the project's dq schema, nothing of its own.
    expect(RICH["dbt_project.yml"]).toContain("+store_failures: true\n  +schema: dq_case_0042");
  });
});

describe("the workbook date macros", () => {
  it("ship exactly the SQL the offline suite runs, with the macro's arguments in place", () => {
    // excelSerial.test.ts runs these functions' SQL on PGlite; a macro adding Jinja of its own
    // would be text that suite never executed.
    for (const [name, sql] of [
      ["excel_serial_date", excelSerialDateSql],
      ["excel_serial_timestamp", excelSerialTimestampSql],
    ] as const) {
      const wrapped = `{% macro ${name}(value, date1904) %}\n${sql("{{ value }}", "{{ date1904 }}")}\n{% endmacro %}\n`;
      const file = PROJECT[`macros/${name}.sql`] ?? "";
      expect(file.endsWith(wrapped)).toBe(true);
      expect(file.slice(0, file.length - wrapped.length)).toMatch(ONLY_A_COMMENT);
      expect(sql("value", "date1904")).not.toMatch(JINJA);
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

  it("keeps a SQL test's step under its own name, and a warn as warn: visible, not failed", () => {
    const parsed = parseRunResults({
      results: [
        {
          unique_id: "test.undercroft.stg_payments__paid_not_after_received",
          status: "warn",
          message: "Got 3 results, configured to warn if != 0",
          failures: 3,
          execution_time: 0.2,
          relation_name: '"undercroft"."dq_case_0042"."stg_payments__paid_not_after_received"',
        },
        {
          unique_id: "test.undercroft.stg_payments__total_matches",
          status: "fail",
          message: "Got 1 result, configured to fail if != 0",
          failures: 1,
          execution_time: 0.1,
          relation_name: '"undercroft"."dq_case_0042"."stg_payments__total_matches"',
        },
      ],
    });

    expect(parsed.steps.map((s) => [s.kind, s.name, s.status, s.failures])).toEqual([
      ["test", "stg_payments__paid_not_after_received", "warn", 3],
      ["test", "stg_payments__total_matches", "fail", 1],
    ]);
    expect(parsed.testsFailed).toBe(1);
  });

  it("something that is not dbt's file yields no steps rather than a guess", () => {
    expect(parseRunResults("garbage")).toEqual({ steps: [], testsFailed: 0 });
    expect(parseRunResults({ results: "no" })).toEqual({ steps: [], testsFailed: 0 });
  });
});

describe("relationsOfModel", () => {
  it("names a long test's failing-rows table and a long model's working copies as dbt does", () => {
    // The hashed name is dbt 1.9's `synthesize_generic_test_names` for this test, computed
    // outside this module: the first 30 characters of `not_null_<model>`, then the md5 of the
    // full 74-character name. A name dbt did not write is a table the delete would never find.
    const model = "fct_customer_lifetime_value_by_region";
    expect(
      relationsOfModel({
        name: model,
        tests: { columns: { first_purchase_country_code: ["not_null"], region: ["unique"] } },
      }).dq,
    ).toEqual([
      "not_null_fct_customer_lifetime_fe86bf5d797738089f46e3e192d7e930",
      `unique_${model}_region`,
    ]);

    // The same synthesis for the tests that carry arguments, and a SQL test's own name.
    expect(
      relationsOfModel({
        name: "pay",
        tests: {
          columns: {
            inv: [{ kind: "relationships", to: "inv", field: "id" }],
            code: [{ kind: "accepted_values", values: ["1", "2"], quote: false }],
          },
          sql: [{ name: "totals_match", sql: "select 1" }],
        },
      }).dq,
    ).toEqual([
      "relationships_pay_inv__id__ref_inv_",
      "accepted_values_pay_code__False__1__2",
      "pay__totals_match",
    ]);
    expect(
      relationsOfModel({
        name: "stg_payments",
        tests: {
          columns: {
            invoice_id: [{ kind: "relationships", to: "stg_invoices", field: "invoice_id" }],
          },
        },
      }).dq,
    ).toEqual(["relationships_stg_payments_431834f3110c18883983394f9bbd3f3c"]);

    const longest = "a".repeat(63);
    expect(relationsOfModel({ name: longest, tests: { columns: {} } }).analytics).toEqual([
      longest,
      `${"a".repeat(54)}__dbt_tmp`,
      `${"a".repeat(51)}__dbt_backup`,
    ]);
  });
});

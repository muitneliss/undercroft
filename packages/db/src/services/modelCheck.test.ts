/**
 * `checkModel`: what it may call certain, what it may only suspect, and what it never claims.
 *
 * Every guard is pinned from both sides -- it fires on the text it exists for, and it stays
 * quiet on the text a correct model is made of -- so a checker that refused everything could
 * not pass. The quiet side includes the places a lexer is easily fooled: a keyword inside a
 * string, a comment, a quoted identifier or a Jinja block.
 */

import { describe, expect, test as it } from "bun:test";

import { declaredSources } from "./dbtSources.ts";
import { checkModel, type FindingCode, type ModelCheck } from "./modelCheck.ts";

const CLEAN = `with deals as (
    select
        source_record_id as deal_id,
        payload -> 'properties' ->> 'dealname' as deal_name
    from {{ source('undercroft', 'records') }}
    where source = 'hubspot'
      and entity = 'deals'
      and deleted_at is null
)

select * from deals
`;

function check(
  sql: string,
  options: { name?: string; tests?: Record<string, string[]>; existing?: string[] } = {},
): ModelCheck {
  return checkModel({
    name: options.name ?? "stg_deals",
    sql,
    tests: { columns: options.tests ?? {} },
    existingModels: options.existing ?? [],
  });
}

function codes(result: ModelCheck): FindingCode[] {
  return result.findings.map((finding) => finding.code);
}

describe("a model a person would write", () => {
  it("has no findings", () => {
    expect(check(CLEAN).findings).toEqual([]);
  });

  it("always says what it could not verify, clean or not", () => {
    expect(check(CLEAN).unverified).toEqual([
      "compiles",
      "payload-keys",
      "column-types",
      "tests-pass",
      "function-effects",
    ]);
    expect(check("").unverified.length).toBeGreaterThan(0);
  });
});

describe("the sources it knows", () => {
  it("are the ones the project's sources.yml declares", () => {
    expect(declaredSources()).toEqual(new Map([["undercroft", ["records", "documents"]]]));
  });
});

describe("errors", () => {
  it("empty: fires on nothing but comments", () => {
    expect(codes(check("-- nothing yet\n/* still nothing */"))).toEqual(["empty"]);
  });

  it("empty: stays quiet on a one-word query", () => {
    expect(codes(check("select 1 as one"))).not.toContain("empty");
  });

  it("semicolon: fires on a trailing semicolon, with its line", () => {
    const result = check("select 1 as one\n;");
    expect(result.findings).toContainEqual({
      code: "semicolon",
      severity: "error",
      line: 2,
      subject: null,
    });
  });

  it("semicolon: stays quiet on one inside a string or a comment", () => {
    expect(codes(check("select ';' as s -- a; b\n/* ; */"))).not.toContain("semicolon");
  });

  it("not-select: fires on a statement that is not a query", () => {
    expect(codes(check("vacuum raw_table"))).toContain("not-select");
  });

  it("not-select: stays quiet on with, select, values and a parenthesised query", () => {
    for (const sql of ["with a as (select 1) select * from a", "values (1)", "(select 1)"]) {
      expect(codes(check(sql))).not.toContain("not-select");
    }
  });

  it("not-select: looks past a leading config() block", () => {
    const sql = "{{ config(materialized='view') }}\nselect 1 as one";
    expect(codes(check(sql))).not.toContain("not-select");
  });

  it("write-statement: fires on a data-modifying CTE, naming the keyword", () => {
    const sql = "with gone as (delete from t returning *) select * from gone";
    expect(check(sql).findings).toContainEqual({
      code: "write-statement",
      severity: "error",
      line: 1,
      subject: "delete",
    });
  });

  it("write-statement: stays quiet on the word in a string, a comment or a quoted name", () => {
    const sql = `select 'drop table x' as s, "update" as u -- delete me\nfrom t where deleted_at is null`;
    expect(codes(check(sql))).not.toContain("write-statement");
  });

  it("write-statement: stays quiet on a column that only contains the word", () => {
    expect(codes(check("select source_updated_at, created_at from t"))).not.toContain(
      "write-statement",
    );
  });

  it("select-into: fires on select ... into", () => {
    expect(codes(check("select * into copy_of_t from t"))).toContain("select-into");
  });

  it("select-into: stays quiet on a select without it", () => {
    expect(codes(check("select * from t"))).not.toContain("select-into");
  });

  it("raw-direct: fires on a declared source read past source()", () => {
    const result = check("select * from raw.records where deleted_at is null");
    expect(result.findings).toContainEqual({
      code: "raw-direct",
      severity: "error",
      line: 1,
      subject: "records",
    });
  });

  it("raw-direct: fires on the quoted spelling too", () => {
    expect(codes(check(`select * from "raw"."documents"`))).toContain("raw-direct");
  });

  it("raw-direct: stays quiet on a raw table no source declares", () => {
    // raw.document_text is granted to dbt but is not a source: reading it directly is the
    // only way there is, so refusing it would refuse a correct model.
    expect(codes(check("select document_id from raw.document_text"))).not.toContain("raw-direct");
  });

  it("analytics-direct: fires on another model read by its schema", () => {
    expect(codes(check("select * from analytics_case_0042.stg_deals"))).toContain(
      "analytics-direct",
    );
  });

  it("analytics-direct: fires on another model read by its bare name, as a report writes it", () => {
    const result = check(`select * from "stg_deals" d join stg_owners o on o.id = d.owner`, {
      name: "fct_deals",
      existing: ["stg_deals", "stg_owners"],
    });
    expect(result.findings.filter((f) => f.code === "analytics-direct")).toEqual([
      { code: "analytics-direct", severity: "error", line: 1, subject: "stg_deals" },
      { code: "analytics-direct", severity: "error", line: 1, subject: "stg_owners" },
    ]);
  });

  it("analytics-direct: stays quiet on a CTE that shares a model's name", () => {
    const sql = "with stg_deals as (select 1 as id) select * from stg_deals";
    expect(codes(check(sql, { name: "fct_deals", existing: ["stg_deals"] }))).toEqual([]);
  });

  it("analytics-direct: stays quiet on ref()", () => {
    const sql = "select * from {{ ref('stg_deals') }}";
    expect(codes(check(sql, { name: "fct_deals", existing: ["stg_deals"] }))).not.toContain(
      "analytics-direct",
    );
  });

  it("unknown-source: fires on a table the sources do not declare", () => {
    const result = check("select * from {{ source('undercroft', 'deals') }}");
    expect(result.findings).toContainEqual({
      code: "unknown-source",
      severity: "error",
      line: 1,
      subject: "undercroft.deals",
    });
  });

  it("unknown-source: stays quiet on a declared one, either quote", () => {
    const sql = `select * from {{ source("undercroft", "documents") }}`;
    expect(codes(check(sql))).not.toContain("unknown-source");
  });

  it("unknown-ref: fires on a model the tenant does not have", () => {
    const result = check("select * from {{ ref('stg_nothing') }}", { existing: ["stg_deals"] });
    expect(result.findings).toContainEqual({
      code: "unknown-ref",
      severity: "error",
      line: 1,
      subject: "stg_nothing",
    });
  });

  it("unknown-ref: stays quiet on one it has, the two-argument form included", () => {
    const sql = "select * from {{ ref('undercroft', 'stg_deals') }}";
    expect(codes(check(sql, { name: "fct_deals", existing: ["stg_deals"] }))).toEqual([]);
  });

  it("report-parameter: fires on a report question's {{ name }} left in the SQL", () => {
    // A question's parameter and a Jinja variable are spelled alike. dbt renders an unknown
    // name as an empty string, so the filter would vanish from a build that succeeds.
    const sql = "select * from t where closed_at >= {{ date_from }}";
    expect(check(sql).findings).toContainEqual({
      code: "report-parameter",
      severity: "error",
      line: 1,
      subject: "date_from",
    });
  });

  it("report-parameter: stays quiet on dbt's own names and a name the model binds", () => {
    const sql = `{% set cutoff = '2026-01-01' %}
select '{{ this }}' as me, '{{ target.schema }}' as s from t where x >= '{{ cutoff }}'`;
    expect(codes(check(sql))).not.toContain("report-parameter");
  });

  it("self-ref: fires on a model that reads itself", () => {
    const sql = "select * from {{ ref('stg_deals') }}";
    expect(codes(check(sql, { existing: ["stg_deals"] }))).toEqual(["self-ref"]);
  });
});

describe("warnings", () => {
  it("no-tombstone-filter: fires when records are read and deleted_at never appears", () => {
    const sql = "select source_record_id from {{ source('undercroft', 'records') }}";
    expect(check(sql).findings).toContainEqual({
      code: "no-tombstone-filter",
      severity: "warning",
      line: null,
      subject: null,
    });
  });

  it("no-tombstone-filter: fires on raw.records as well", () => {
    expect(codes(check("select 1 from raw.records"))).toContain("no-tombstone-filter");
  });

  it("no-tombstone-filter: stays quiet when records are not read", () => {
    expect(codes(check("select * from {{ source('undercroft', 'documents') }}"))).toEqual([]);
  });

  it("zero-default: fires on coalesce(..., 0), a cast included", () => {
    for (const sql of [
      "select coalesce(amount, 0) from t",
      "select coalesce(a, b, 0.00::numeric) from t",
    ]) {
      expect(codes(check(sql))).toContain("zero-default");
    }
  });

  it("zero-default: stays quiet on coalesce with a non-zero or nested zero", () => {
    for (const sql of [
      "select coalesce(amount, 10) from t",
      "select coalesce(greatest(a, 0), b) from t",
      "select coalesce(label, 'none') from t",
    ]) {
      expect(codes(check(sql))).not.toContain("zero-default");
    }
  });

  it("top-level-limit: fires on a limit that caps the whole model", () => {
    expect(check("select * from t\nlimit 100").findings).toContainEqual({
      code: "top-level-limit",
      severity: "warning",
      line: 2,
      subject: null,
    });
  });

  it("top-level-limit: stays quiet on a limit inside a subquery", () => {
    expect(codes(check("select * from (select * from t order by x limit 1) newest"))).toEqual([]);
  });

  it("unknown-macro: fires on a call the project does not ship", () => {
    const sql = "select {{ dbt_utils.star(ref('stg_deals')) }} from t";
    const result = check(sql, { name: "fct_deals", existing: ["stg_deals"] });
    expect(result.findings).toContainEqual({
      code: "unknown-macro",
      severity: "warning",
      line: 1,
      subject: "dbt_utils",
    });
  });

  it("unknown-macro: stays quiet on the shipped macros and dbt's own functions", () => {
    const sql = `{{ config(materialized='table') }}
select {{ parse_amount("payload", 'amount') }} as amount, '{{ var("x", "y") }}' as v
from {{ gmail_letters() }} l`;
    expect(codes(check(sql))).toEqual([]);
  });

  it("dynamic-reference: fires on a ref whose name is not written out", () => {
    expect(codes(check("select * from {{ ref(var('upstream')) }}"))).toContain("dynamic-reference");
  });

  it("dynamic-reference: stays quiet on a literal one", () => {
    const sql = "select * from {{ ref('stg_deals') }}";
    expect(codes(check(sql, { name: "fct", existing: ["stg_deals"] }))).not.toContain(
      "dynamic-reference",
    );
  });

  it("test-column-unmentioned: fires on a test for a column the SQL never names", () => {
    const result = check(CLEAN, { tests: { dealid: ["unique"] } });
    expect(result.findings).toEqual([
      { code: "test-column-unmentioned", severity: "warning", line: null, subject: "dealid" },
    ]);
  });

  it("test-column-unmentioned: stays quiet on a column the SQL names", () => {
    expect(check(CLEAN, { tests: { deal_id: ["unique", "not_null"] } }).findings).toEqual([]);
  });
});

describe("Jinja", () => {
  it("keeps line numbers for what follows a multi-line block", () => {
    const sql = "{{\n  config(materialized='table')\n}}\nselect 1 as one;";
    expect(check(sql).findings).toContainEqual({
      code: "semicolon",
      severity: "error",
      line: 4,
      subject: null,
    });
  });

  it("finds a reference inside a set block", () => {
    const sql = "{% set upstream = ref('stg_gone') %}\nselect * from {{ upstream }}";
    expect(codes(check(sql))).toContain("unknown-ref");
  });

  it("ignores a Jinja comment's contents", () => {
    const sql = "{# drop table x; ref('nothing') #}\nselect 1 as one";
    expect(check(sql).findings).toEqual([]);
  });
});

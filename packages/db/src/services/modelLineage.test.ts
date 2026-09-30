/**
 * `modelLineage`: an edge for every declaration and for nothing else.
 *
 * Each guard is pinned from both sides. An edge appears for a literal `ref()` or `source()`,
 * and none appears between models that only look alike; "upstream not declared" fires on a
 * dynamic reference, an unknown macro, a relation named directly and a query run from Jinja,
 * and stays quiet on the model a person would write -- so a reader that marked everything
 * undeclared, or drew an edge between every pair, could not pass.
 */

import { describe, expect, test as it } from "bun:test";

import { MACROS } from "./dbtProject.ts";
import { type Lineage, type LineageNode, modelLineage } from "./modelLineage.ts";

const STG_DEALS = `select source_record_id as deal_id
from {{ source('undercroft', 'records') }}
where entity = 'deals' and deleted_at is null`;

const STG_FILES = `select document_id, name
from {{ source('undercroft', 'documents') }}`;

const MART = `select d.deal_id, f.name
from {{ ref('stg_deals') }} d
join {{ ref('stg_files') }} f on f.document_id = d.deal_id`;

function texts(record: Record<string, string>): { name: string; sql: string }[] {
  return Object.entries(record).map(([name, sql]) => ({ name, sql }));
}

function lineage(models: Record<string, string>, macros: Record<string, string> = {}): Lineage {
  return modelLineage({ models: texts(models), macros: texts(macros) });
}

function edges(graph: Lineage): string[] {
  return graph.edges.map((edge) => `${edge.from} -> ${edge.to}`);
}

function model(graph: Lineage, name: string): Extract<LineageNode, { kind: "model" }> {
  const node = graph.nodes.find((n) => n.id === `model:${name}`);
  if (node?.kind !== "model") {
    throw new Error(`no model ${name}`);
  }
  return node;
}

function reasons(graph: Lineage, name: string): string[] {
  return model(graph, name).undeclared.map((r) => `${r.code}:${r.subject ?? ""}`);
}

describe("declared relations", () => {
  const graph = lineage({
    mart_pipeline: MART,
    stg_deals: STG_DEALS,
    stg_files: STG_FILES,
    stg_notes: "select 1 as note from {{ source('undercroft', 'records') }}",
  });

  it("draws a model's two refs and each one's declared raw lake table", () => {
    expect(edges(graph)).toEqual(
      expect.arrayContaining([
        "model:stg_deals -> model:mart_pipeline",
        "model:stg_files -> model:mart_pipeline",
        "raw:raw.records -> model:stg_deals",
        "raw:raw.documents -> model:stg_files",
      ]),
    );
    expect(reasons(graph, "mart_pipeline")).toEqual([]);
  });

  it("puts a model that nothing refs in no one's upstream", () => {
    expect(edges(graph).filter((edge) => edge.startsWith("model:stg_notes"))).toEqual([]);
  });

  it("has a node per model and per raw table read, and no other kind of node", () => {
    expect(graph.nodes.map((node) => node.id)).toEqual([
      "raw:raw.documents",
      "raw:raw.records",
      "model:mart_pipeline",
      "model:stg_deals",
      "model:stg_files",
      "model:stg_notes",
    ]);
  });
});

describe("nothing inferred", () => {
  it("draws no edge between look-alike names, or from a name in a string or comment", () => {
    const graph = lineage({
      stg_deals: STG_DEALS,
      stg_deals_v2: `-- replaces stg_deals
select 'stg_deals' as origin from {{ source('undercroft', 'records') }}
where source = 'hubspot.3fa9c1d2e0ab'`,
    });
    expect(edges(graph)).toEqual([
      "raw:raw.records -> model:stg_deals",
      "raw:raw.records -> model:stg_deals_v2",
    ]);
    expect(reasons(graph, "stg_deals_v2")).toEqual([]);
  });
});

describe("upstream not declared", () => {
  it("fires on a ref whose argument is not a literal, keeping the literal ones", () => {
    const graph = lineage({
      stg_deals: STG_DEALS,
      mart: "select * from {{ ref(var('which')) }} join {{ ref('stg_deals') }} using (deal_id)",
    });
    expect(reasons(graph, "mart")).toEqual(["dynamic-reference:ref"]);
    expect(edges(graph)).toContain("model:stg_deals -> model:mart");
  });

  it("fires on a call to a macro the project does not hold, and not on one it does", () => {
    const graph = lineage(
      {
        uses_unknown: "select {{ dbt_utils.star(ref('stg_deals')) }} from {{ ref('stg_deals') }}",
        uses_own: "select {{ cents('amount') }} from {{ ref('stg_deals') }}",
        uses_platform:
          "select {{ parse_amount('payload', 'amount') }} as amount from {{ ref('stg_deals') }}",
        stg_deals: STG_DEALS,
      },
      { cents: "{% macro cents(column) %}({{ column }} * 100){% endmacro %}" },
    );
    expect(reasons(graph, "uses_unknown")).toEqual(["unknown-macro:dbt_utils"]);
    expect(reasons(graph, "uses_own")).toEqual([]);
    expect(reasons(graph, "uses_platform")).toEqual([]);
  });

  it("fires on a raw table named directly, and not on a source() aliased raw", () => {
    const graph = lineage({
      direct: "select * from raw.records where deleted_at is null",
      text: "select document_id from raw.document_text",
      aliased: "select raw.payload from {{ source('undercroft', 'records') }} raw",
    });
    expect(reasons(graph, "direct")).toEqual(["direct-read:raw.records"]);
    expect(reasons(graph, "text")).toEqual(["direct-read:raw.document_text"]);
    expect(reasons(graph, "aliased")).toEqual([]);
  });

  it("fires on another model named bare, which dbt would not build first", () => {
    const graph = lineage({ stg_deals: STG_DEALS, mart: "select * from stg_deals" });
    expect(reasons(graph, "mart")).toEqual(["direct-read:stg_deals"]);
    expect(edges(graph)).not.toContain("model:stg_deals -> model:mart");
  });

  it("fires on a query run from inside Jinja", () => {
    const graph = lineage({
      mart: "{% set rows = run_query('select 1') %}select 1 as one from {{ ref('stg_deals') }}",
      stg_deals: STG_DEALS,
    });
    expect(reasons(graph, "mart")).toEqual(["query-in-jinja:run_query"]);
  });
});

describe("a ref to a model that no longer exists", () => {
  it("is a missing dependency, and its edge is kept", () => {
    const graph = lineage({ mart: "select * from {{ ref('stg_deleted') }}" });
    expect(graph.nodes).toContainEqual({
      kind: "missing",
      id: "missing:stg_deleted",
      name: "stg_deleted",
    });
    expect(edges(graph)).toEqual(["missing:stg_deleted -> model:mart"]);
  });

  it("is not reported for a ref that resolves", () => {
    const graph = lineage({ stg_deals: STG_DEALS, mart: "select * from {{ ref('stg_deals') }}" });
    expect(graph.nodes.filter((node) => node.kind === "missing")).toEqual([]);
  });
});

describe("a macro's declarations", () => {
  it("count for the model that calls the shipped gmail_letters()", () => {
    const graph = lineage({ letters: "select * from {{ gmail_letters() }} l" });
    expect(graph.edges).toEqual([
      { from: "raw:raw.records", to: "model:letters", via: "gmail_letters" },
    ]);
    expect(reasons(graph, "letters")).toEqual([]);
  });

  it("count through a tenant's macros, transitively, and a cycle between them ends", () => {
    const graph = lineage(
      { mart: "select * from {{ deals_base() }} d", stg_deals: STG_DEALS },
      {
        deals_base: "{% macro deals_base() %}({{ deals_inner() }}){% endmacro %}",
        deals_inner:
          "{% macro deals_inner() %}select * from {{ ref('stg_deals') }} {# {{ deals_base() }} #}{{ deals_back() }}{% endmacro %}",
        deals_back: "{% macro deals_back() %}{{ deals_base() }}{% endmacro %}",
      },
    );
    expect(graph.edges).toContainEqual({
      from: "model:stg_deals",
      to: "model:mart",
      via: "deals_inner",
    });
    expect(reasons(graph, "mart")).toEqual([]);
  });

  it("carry a macro's own undeclared reading to its caller, naming the macro", () => {
    const graph = lineage(
      { mart: "select * from {{ pick() }} p" },
      { pick: "{% macro pick() %}{{ ref(var('which')) }}{% endmacro %}" },
    );
    expect(model(graph, "mart").undeclared).toEqual([
      { code: "dynamic-reference", subject: "ref", via: "pick" },
    ]);
  });

  it("of every shipped macro read as declared, so none marks its caller", () => {
    for (const macro of MACROS) {
      const graph = lineage({ caller: `select * from {{ ${macro.name}() }} x` });
      expect(reasons(graph, "caller")).toEqual([]);
    }
  });
});

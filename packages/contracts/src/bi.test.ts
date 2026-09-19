/**
 * What the compiler promises: a visual definition becomes exactly the SQL a reader can
 * check, every identifier quoted and every value a literal; a parameter is bound as a
 * literal with its quotes doubled, or refused when unbound; and `*` is count's alone.
 */

// biome-ignore-all lint/style/useNamingConvention: `is_null` and `not_null` are the filter ops as stored and sent over the wire.

import { describe, expect, test as it } from "bun:test";

import {
  bindParams,
  compile,
  compileVisual,
  ParamMissing,
  paramNames,
  VisualDefinition,
} from "./bi.ts";

const COUNT_ONLY = /count/u;

const DEALS = VisualDefinition.parse({
  kind: "visual",
  table: "stg_deals",
  fields: [
    { column: "stage" },
    { column: "amount", aggregate: "sum" },
    { column: "*", aggregate: "count", alias: "deals" },
  ],
  filters: [
    { column: "closed_at", op: "gte", value: "{{period_from}}" },
    { column: "deal_name", op: "contains", value: "O'Brien" },
    { column: "stage", op: "in", value: ["won", "lost"] },
    { column: "pipeline", op: "not_null" },
  ],
  groupBy: ["stage"],
  orderBy: [{ by: "sum_amount", dir: "desc" }],
  limit: 100,
});

describe("compileVisual", () => {
  it("writes the SQL a reader can check, identifiers quoted, values as literals", () => {
    expect(compileVisual(DEALS)).toBe(
      [
        'SELECT "stage", sum("amount") AS "sum_amount", count(*) AS "deals"',
        'FROM "stg_deals"',
        'WHERE "closed_at" >= {{period_from}}',
        `  AND "deal_name"::text ILIKE '%O''Brien%'`,
        `  AND "stage" IN ('won', 'lost')`,
        '  AND "pipeline" IS NOT NULL',
        'GROUP BY "stage"',
        'ORDER BY "sum_amount" DESC',
        "LIMIT 100",
      ].join("\n"),
    );
  });

  it("* is count's alone", () => {
    expect(() =>
      compileVisual({
        ...DEALS,
        fields: [{ column: "*", aggregate: "sum" }],
      }),
    ).toThrow(COUNT_ONLY);
  });

  it("a SQL question compiles to itself", () => {
    expect(compile({ kind: "sql", sql: "select 1" })).toBe("select 1");
  });
});

describe("parameters", () => {
  it("are found once each, bound as quoted literals, and refused when unbound", () => {
    const sql = "select * from t where a = {{ from }} and b = {{to}} and c = {{from}}";
    expect(paramNames(sql)).toEqual(["from", "to"]);
    expect(bindParams(sql, { from: "2026-01-01", to: "it's" })).toBe(
      "select * from t where a = '2026-01-01' and b = 'it''s' and c = '2026-01-01'",
    );
    expect(bindParams("x in {{xs}}", { xs: ["a", "b"] })).toBe("x in ('a', 'b')");
    expect(() => bindParams(sql, { from: "2026-01-01" })).toThrow(ParamMissing);
  });

  it("a visual filter's parameter reaches the SQL unquoted, so binding quotes it once", () => {
    const sql = bindParams(compileVisual(DEALS), { period_from: "2026-01-01" });
    expect(sql).toContain(`"closed_at" >= '2026-01-01'`);
  });
});

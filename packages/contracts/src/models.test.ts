/**
 * `ModelTests`: which tests a model may declare (ADR 0130), and that every row stored before
 * them still reads as it did. Each refusal is pinned beside an accepted neighbour, so a schema
 * that refused everything could not pass.
 */

import { describe, expect, test as it } from "bun:test";

import { canonicalTests, ModelTests } from "./models.ts";

function accepts(tests: unknown): boolean {
  return ModelTests.safeParse(tests).success;
}

describe("ModelTests", () => {
  it("reads a row saved before ADR 0130 exactly as it was stored", () => {
    const legacy = { columns: { deal_id: ["not_null", "unique"], stage: [] } };
    expect<unknown>(ModelTests.parse(legacy)).toEqual(legacy);
    expect(ModelTests.parse({})).toEqual({ columns: {} });
  });

  it("accepts accepted_values as text, quoted or not, and refuses what dbt would misread", () => {
    function column(test: unknown) {
      return { columns: { status: [test] } };
    }
    expect(accepts(column({ kind: "accepted_values", values: ["open", "paid"] }))).toBe(true);
    expect(accepts(column({ kind: "accepted_values", values: ["1", "2.50"], quote: false }))).toBe(
      true,
    );
    // A bare value is spliced into SQL: only a decimal may be.
    expect(
      accepts(column({ kind: "accepted_values", values: ["1", "1) or (1=1"], quote: false })),
    ).toBe(false);
    // A number is never accepted as a number: money stays a string end to end.
    expect(accepts(column({ kind: "accepted_values", values: [1, 2] }))).toBe(false);
    expect(accepts(column({ kind: "accepted_values", values: [] }))).toBe(false);
    // A brace is Jinja to dbt, which renders test arguments.
    expect(accepts(column({ kind: "accepted_values", values: ["{{ var('x') }}"] }))).toBe(false);
  });

  it("accepts relationships to a model by name, and refuses one to anything else", () => {
    function column(test: unknown) {
      return { columns: { invoice_id: [test] } };
    }
    expect(
      accepts(column({ kind: "relationships", to: "stg_invoices", field: "invoice_id" })),
    ).toBe(true);
    expect(
      accepts(column({ kind: "relationships", to: "ref('stg_invoices')", field: "invoice_id" })),
    ).toBe(false);
    expect(accepts(column({ kind: "relationships", to: "stg_invoices" }))).toBe(false);
  });

  it("takes a severity of error or warn on every test, and nothing else", () => {
    expect(accepts({ columns: { id: [{ kind: "not_null", severity: "warn" }] } })).toBe(true);
    expect(accepts({ columns: { id: [{ kind: "not_null", severity: "info" }] } })).toBe(false);
    expect(
      accepts({ columns: {}, sql: [{ name: "no_future", sql: "select 1", severity: "warn" }] }),
    ).toBe(true);
  });

  it("refuses a column test twice and two SQL tests of one name: dbt would not compile them", () => {
    expect(accepts({ columns: { id: ["not_null", { kind: "not_null", severity: "warn" }] } })).toBe(
      false,
    );
    const test = { name: "no_future", sql: "select 1" };
    expect(accepts({ columns: {}, sql: [test] })).toBe(true);
    expect(accepts({ columns: {}, sql: [test, test] })).toBe(false);
  });

  it("refuses a SQL test name with a double underscore, which would hide its model", () => {
    expect(accepts({ columns: {}, sql: [{ name: "totals_match", sql: "select 1" }] })).toBe(true);
    expect(accepts({ columns: {}, sql: [{ name: "totals__match", sql: "select 1" }] })).toBe(false);
    expect(accepts({ columns: {}, sql: [{ name: "totals_", sql: "select 1" }] })).toBe(false);
  });

  it("refuses an unknown kind or an unknown key rather than dropping it", () => {
    expect(accepts({ columns: { id: ["between"] } })).toBe(false);
    expect(accepts({ columns: { id: [{ kind: "unique", where: "x > 0" }] } })).toBe(false);
    expect(accepts({ columns: {}, rules: [] })).toBe(false);
  });
});

describe("canonicalTests", () => {
  it("spells the same tests one way, so a re-save of the same meaning is no change", () => {
    expect(
      canonicalTests({
        columns: {
          id: [{ kind: "not_null" }, { kind: "unique", severity: "error" }],
          status: [{ kind: "accepted_values", values: ["open"], severity: "error" }],
        },
        sql: [],
      }),
    ).toEqual({
      columns: {
        id: ["not_null", "unique"],
        status: [{ kind: "accepted_values", values: ["open"] }],
      },
    });
    const warned = { columns: { id: [{ kind: "not_null" as const, severity: "warn" as const }] } };
    expect(canonicalTests(warned)).toEqual(warned);
  });
});

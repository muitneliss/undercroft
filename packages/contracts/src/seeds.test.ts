/**
 * What a seed's cell may be for its column's declared type, and the file dbt loads it from.
 * ADR 0128.
 *
 * Each refusal is pinned from both sides -- the cell it fires on, and the nearest cell it must
 * admit -- because every one exists to stop dbt's loader or Postgres changing a value without a
 * word, and a rule that refused too much would be as broken as one that refused nothing.
 */

import { describe, expect, test as it } from "bun:test";

import { type SeedProblem, seedCsv, seedRefusal } from "./seeds.ts";

/** The problem one cell has in a one-column table of `type`, or `null`. */
function cell(type: string, value: string | null): SeedProblem | null {
  return seedRefusal({ columns: [{ name: "c", type }], rows: [[value]] })?.problem ?? null;
}

describe("a typed cell", () => {
  const cases: [string, string, SeedProblem, string][] = [
    // type, refused, why, the nearest admitted
    ["integer", "007", "not-integer", "7"],
    ["integer", "1.0", "not-integer", "-1"],
    ["integer", "2147483648", "out-of-range", "2147483647"],
    ["bigint", "9223372036854775808", "out-of-range", "-9223372036854775808"],
    ["numeric(18,4)", "1,234.5", "not-decimal", "1234.5"],
    ["numeric(18,4)", "1e3", "not-decimal", "1000"],
    ["numeric(18,4)", "123456789012345", "too-many-digits", "12345678901234"],
    ["numeric(18,4)", "0.00001", "too-many-decimals", "-0.0001"],
    ["boolean", "TRUE", "not-boolean", "false"],
    ["date", "2025-02-29", "not-date", "2024-02-29"],
    ["date", "0000-01-01", "not-date", "0001-01-01"],
    ["timestamptz", "2026-10-13 09:00:00", "no-offset", "2026-10-13 09:00:00+07:00"],
    ["timestamptz", "2026-10-13T24:00:00Z", "not-timestamp", "2026-10-13T23:59:59.123456Z"],
    ["text", "NULL", "reads-as-null", "NULL value"],
    ["text", " \u0085", "reads-as-null", "-"],
    // Python does not strip a byte-order mark, so dbt loads it as the text it is.
    ["text", "\t", "reads-as-null", "\ufeff"],
    ["text", "a\r\nb", "carriage-return", "a\nb"],
    ["text", "a\u0000b", "unstorable-character", "a b"],
    ["text", "\ud800", "unstorable-character", "😀"],
  ];

  for (const [type, refused, why, admitted] of cases) {
    it(`${type}: refuses ${JSON.stringify(refused)} as ${why}, admits ${JSON.stringify(admitted)}`, () => {
      expect(cell(type, refused)).toBe(why);
      expect(cell(type, admitted)).toBeNull();
    });
  }

  it("is NULL as null in a column of any type", () => {
    for (const type of ["text", "integer", "numeric(18,4)", "boolean", "date", "timestamptz"]) {
      expect(cell(type, null)).toBeNull();
    }
  });

  it("names the row and the column it fails at, the first in reading order", () => {
    const refusal = seedRefusal({
      columns: [
        { name: "code", type: "text" },
        { name: "budget", type: "numeric(18,4)" },
      ],
      rows: [
        ["511", "1.5"],
        ["642", "1.23456"],
        ["", "x"],
      ],
    });
    expect(refusal).toEqual({ problem: "too-many-decimals", row: 1, column: "budget" });
  });
});

describe("a table's shape", () => {
  it("refuses a row of the wrong width, an undeclared type and a column named twice", () => {
    const text = { name: "a", type: "text" };
    expect(seedRefusal({ columns: [text], rows: [["1", "2"]] })).toEqual({
      problem: "row-width",
      row: 0,
      column: null,
    });
    expect(seedRefusal({ columns: [{ name: "a", type: "varchar" }], rows: [] })?.problem).toBe(
      "unknown-type",
    );
    expect(seedRefusal({ columns: [text, { name: "a", type: "date" }], rows: [] })).toEqual({
      problem: "duplicate-column",
      row: null,
      column: "a",
    });
    expect(seedRefusal({ columns: [text, { name: "b", type: "date" }], rows: [] })).toBeNull();
  });
});

describe("seedCsv", () => {
  it("quotes every value, doubles a quote, keeps a line feed inside its field, and leaves NULL empty", () => {
    const csv = seedCsv({
      columns: [
        { name: "code", type: "text" },
        { name: "note", type: "text" },
        { name: "budget", type: "numeric(18,4)" },
      ],
      rows: [
        ["0511", 'Giá vốn, "trực tiếp"', "-0.0001"],
        ["=SUM(A1)", "hai\ndòng", null],
      ],
    });
    // No formula guard: `=SUM(A1)` is a value dbt loads as written, not a spreadsheet cell.
    expect(csv).toBe(
      'code,note,budget\n"0511","Giá vốn, ""trực tiếp""","-0.0001"\n"=SUM(A1)","hai\ndòng",\n',
    );
  });

  it("is the header alone for a table with no rows", () => {
    expect(seedCsv({ columns: [{ name: "code", type: "text" }], rows: [] })).toBe("code\n");
  });
});

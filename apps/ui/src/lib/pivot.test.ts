/**
 * What the pivot promises: sums are exact to the widest scale seen, an absent combination is
 * missing rather than zero, the totals agree with the cells -- and any sum a missing value
 * should have been part of is marked incomplete, all the way up to the grand total, while a
 * group that is whole still prints plainly.
 */

import { describe, expect, test as it } from "bun:test";

import type { TableResult } from "@/api/types.ts";
import { pivot } from "./pivot.ts";

const SALES: TableResult = {
  columns: [
    { name: "month", type: "text" },
    { name: "region", type: "text" },
    { name: "total", type: "numeric" },
  ],
  rows: [
    ["2026-01", "north", "0.1"],
    ["2026-01", "north", "0.2"],
    ["2026-01", "south", "1000.0000"],
    ["2026-02", "north", "5"],
  ],
  truncated: false,
};

function whole(sum: string | null): { sum: string | null; incomplete: boolean } {
  return { sum, incomplete: false };
}

function partial(sum: string | null): { sum: string | null; incomplete: boolean } {
  return { sum, incomplete: true };
}

describe("pivot", () => {
  it("sums exactly, leaves an absent combination missing, and totals what it summed", () => {
    const table = pivot(SALES, { rowsBy: "month", colsBy: "region", value: "total" }, "Total");

    expect(table.columns).toEqual(["north", "south"]);
    expect(table.rows).toEqual([
      { key: "2026-01", cells: [whole("0.3000"), whole("1000.0000")], total: whole("1000.3000") },
      { key: "2026-02", cells: [whole("5.0000"), whole(null)], total: whole("5.0000") },
    ]);
    expect(table.totals).toEqual([whole("5.3000"), whole("1000.0000"), whole("1005.3000")]);
  });

  it("marks every sum over a missing amount incomplete, and leaves the whole group plain", () => {
    const withGap: TableResult = {
      ...SALES,
      rows: [
        ["A", "north", "10"],
        ["A", "north", null],
        ["A", "south", "2"],
        ["B", "south", "7"],
      ],
    };
    const table = pivot(withGap, { rowsBy: "month", colsBy: "region", value: "total" }, "Total");

    expect(table.rows).toEqual([
      { key: "A", cells: [partial("10"), whole("2")], total: partial("12") },
      { key: "B", cells: [whole(null), whole("7")], total: whole("7") },
    ]);
    expect(table.totals).toEqual([partial("10"), whole("9"), partial("19")]);
  });

  it("with no column to split by, one column carries the row's sum, marked when partial", () => {
    const withGap: TableResult = { ...SALES, rows: [...SALES.rows, ["2026-02", "south", null]] };
    const table = pivot(withGap, { rowsBy: "month", colsBy: null, value: "total" }, "Total");
    expect(table.columns).toEqual(["Total"]);
    expect(table.rows.map((row) => row.cells)).toEqual([[whole("1000.3000")], [partial("5.0000")]]);
    expect(table.totals.at(-1)).toEqual(partial("1005.3000"));
  });
});

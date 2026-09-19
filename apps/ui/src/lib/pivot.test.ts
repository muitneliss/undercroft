/**
 * What the pivot promises: sums are exact to the widest scale seen, a null contributes
 * nothing and an empty cell is missing rather than zero, and the totals agree with the
 * cells.
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
    ["2026-02", "south", null],
  ],
  truncated: false,
};

describe("pivot", () => {
  it("sums exactly, leaves an untouched cell missing, and totals what it summed", () => {
    const table = pivot(SALES, { rowsBy: "month", colsBy: "region", value: "total" }, "Total");

    expect(table.columns).toEqual(["north", "south"]);
    expect(table.rows).toEqual([
      { key: "2026-01", cells: ["0.3000", "1000.0000"], total: "1000.3000" },
      { key: "2026-02", cells: [null, null], total: null },
    ]);
    expect(table.totals).toEqual(["0.3000", "1000.0000", "1000.3000"]);
  });

  it("with no column to split by, one column carries the row's sum", () => {
    const table = pivot(SALES, { rowsBy: "month", colsBy: null, value: "total" }, "Total");
    expect(table.columns).toEqual(["Total"]);
    expect(table.rows[0]?.cells).toEqual(["1000.3000"]);
  });
});

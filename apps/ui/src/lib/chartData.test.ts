/**
 * What series promise: the label and value columns are inferred from the result's types
 * when the chart does not say, a numeric string keeps every digit beside its plotted float,
 * a null is a gap and never a zero, and past seven series the rest fold into "Other".
 */

// biome-ignore-all lint/security/noSecrets: False positives. The rule flags high-entropy string literals, and these are test fixtures with invented values (per .claude/rules/pii.md, fixtures are invented rather than anonymised), plus base64url sample tokens and SQL role names. No real credential is in any tracked file; CI enforces that separately.

import { describe, expect, test as it } from "bun:test";

import type { TableResult } from "@/api/types.ts";
import { toSeries } from "./chartData.ts";

const BY_STAGE: TableResult = {
  columns: [
    { name: "stage", type: "text" },
    { name: "sum_amount", type: "numeric" },
    { name: "deals", type: "integer" },
  ],
  rows: [
    ["won", "12345678901234.5678", 3],
    ["lost", null, 1],
    ["open", "10.5", 0],
  ],
  truncated: false,
};

const CHART = { type: "bar" as const, y: [], options: {} };

describe("toSeries", () => {
  it("infers the label column from the types, plots every numeric column, keeps the digits", () => {
    const series = toSeries(BY_STAGE, CHART, "Other");

    expect(series.x).toBe("stage");
    expect(series.y).toEqual(["sum_amount", "deals"]);
    expect(series.labels).toEqual(["won", "lost", "open"]);
    expect(series.datasets[0]?.values).toEqual([12_345_678_901_234.568, null, 10.5]);
    expect(series.datasets[0]?.raw).toEqual(["12345678901234.5678", null, "10.5"]);
    expect(series.datasets[1]?.values).toEqual([3, 1, 0]);
  });

  it("pivots on a series column and folds the eighth and later into Other", () => {
    const rows: TableResult["rows"] = [];
    for (let i = 0; i < 9; i += 1) {
      rows.push(["2026-01", `s${String(i)}`, String(i)]);
    }
    const wide: TableResult = {
      columns: [
        { name: "month", type: "text" },
        { name: "customer", type: "text" },
        { name: "total", type: "numeric" },
      ],
      rows,
      truncated: false,
    };

    const series = toSeries(
      wide,
      { ...CHART, x: "month", series: "customer", y: ["total"] },
      "Other",
    );
    expect(series.labels).toEqual(["2026-01"]);
    expect(series.datasets.map((d) => d.label)).toEqual([
      "s0",
      "s1",
      "s2",
      "s3",
      "s4",
      "s5",
      "s6",
      "Other",
    ]);
    // Seven and eight fold: 7 + 8 as positions, and no readable figure for the fold.
    expect(series.datasets[7]?.values).toEqual([15]);
    expect(series.datasets[7]?.raw).toEqual([null]);
    expect(series.datasets[2]?.raw).toEqual(["2"]);
  });
});

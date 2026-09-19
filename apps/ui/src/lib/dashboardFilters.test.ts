import { describe, expect, test as it } from "bun:test";

import { paramsOf, presetRange } from "./dashboardFilters.ts";

describe("dashboard filters", () => {
  it("a date range binds a from and a to; a text or number filter binds its own name", () => {
    expect(paramsOf({ name: "period", kind: "date_range", label: "Kỳ" })).toEqual([
      "period_from",
      "period_to",
    ]);
    expect(paramsOf({ name: "stage", kind: "text", label: "Giai đoạn" })).toEqual(["stage"]);
    expect(paramsOf({ name: "floor", kind: "number", label: "Từ" })).toEqual(["floor"]);
  });

  it("a preset's days are counted in Asia/Singapore, not in the browser's zone", () => {
    // 17:30 UTC on the 19th is already 01:30 on the 20th in Singapore.
    const now = new Date("2026-09-19T17:30:00Z");
    expect(presetRange("last7", now)).toEqual({ from: "2026-09-14", to: "2026-09-20" });
    expect(presetRange("thisMonth", now)).toEqual({ from: "2026-09-01", to: "2026-09-20" });
    expect(presetRange("thisYear", now)).toEqual({ from: "2026-01-01", to: "2026-09-20" });
  });
});

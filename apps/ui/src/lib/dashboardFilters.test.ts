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
    // 16:30 UTC on the 19th is 00:30 on the 20th in Singapore, but still 23:30 on the 19th in
    // Vietnam and 16:30 on the 19th in UTC -- so a preset counted in the browser's zone says
    // the 19th on a Hanoi laptop and on a UTC runner alike. An hour later it is the 20th in
    // Vietnam too, and the test would pass there for the wrong reason.
    const now = new Date("2026-09-19T16:30:00Z");
    expect(presetRange("last7", now)).toEqual({ from: "2026-09-14", to: "2026-09-20" });
    expect(presetRange("thisMonth", now)).toEqual({ from: "2026-09-01", to: "2026-09-20" });
    expect(presetRange("thisYear", now)).toEqual({ from: "2026-01-01", to: "2026-09-20" });
  });
});

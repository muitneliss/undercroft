import { afterAll, beforeAll, describe, expect, test as it } from "bun:test";

import { enterZone, leaveZone, SINGAPORE, VIETNAM } from "@/test/zone.ts";
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
});

// 16:30 UTC on the 19th is 23:30 on the 19th in Vietnam, but already 00:30 on the 20th in
// Singapore. An hour later it is the 20th in both, and the pair would pass for the wrong reason.
const NOW = new Date("2026-09-19T16:30:00Z");

describe("a preset in Vietnam", () => {
  beforeAll(() => enterZone(VIETNAM));
  afterAll(leaveZone);

  it("counts the reader's own days, so today is the date their screen shows", () => {
    expect(presetRange("last7", NOW)).toEqual({ from: "2026-09-13", to: "2026-09-19" });
    expect(presetRange("thisMonth", NOW)).toEqual({ from: "2026-09-01", to: "2026-09-19" });
    expect(presetRange("thisYear", NOW)).toEqual({ from: "2026-01-01", to: "2026-09-19" });
  });
});

describe("a preset in Singapore", () => {
  beforeAll(() => enterZone(SINGAPORE));
  afterAll(leaveZone);

  it("is a day later for the same instant, because the reader's day is", () => {
    expect(presetRange("last7", NOW)).toEqual({ from: "2026-09-14", to: "2026-09-20" });
    expect(presetRange("last30", NOW)).toEqual({ from: "2026-08-22", to: "2026-09-20" });
  });
});

describe("a preset across a daylight-saving change", () => {
  beforeAll(() => enterZone("Europe/Berlin"));
  afterAll(leaveZone);

  it("counts calendar days, not 24-hour steps", () => {
    // 22:30 UTC on 31 March is 00:30 on 1 April in Berlin, and the clocks went forward on 29
    // March, so six days of 24 hours back lands at 23:30 on 25 March -- a day too far.
    const now = new Date("2026-03-31T22:30:00Z");
    expect(presetRange("last7", now)).toEqual({ from: "2026-03-26", to: "2026-04-01" });
  });
});

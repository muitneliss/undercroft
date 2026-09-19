/**
 * A run's outcome wears the grant's own four marks, and the next run is worded honestly.
 */

import { describe, expect, test as it } from "bun:test";

import { translatorFor } from "@/i18n/index.ts";
import { nextRunNote, runMark, runMarkLabel } from "./runs.ts";

const en = translatorFor("en");
const vi = translatorFor("vi");
const NOW = new Date("2026-09-17T12:00:00Z");

describe("runMark", () => {
  it("maps the three outcomes and the absence of one onto the four geometries", () => {
    expect(runMark("ok")).toBe("granted");
    expect(runMark("running")).toBe("pending");
    expect(runMark("failed")).toBe("lapsed");
    expect(runMark(null)).toBe("absent");
  });

  it("words each mark in the reader's language", () => {
    expect(runMarkLabel(vi, null)).toBe("Chưa chạy");
    expect(runMarkLabel(en, "failed")).toBe("Failed");
    expect(runMarkLabel(vi, "running")).not.toBe(runMarkLabel(en, "running"));
  });
});

describe("nextRunNote", () => {
  it("a future due time is printed as a date in the fixed zone", () => {
    // 17:30 UTC is 01:30 the next day in Singapore, in either language.
    const note = nextRunNote(
      en,
      "en",
      { cadence: "daily", nextRunAt: "2026-09-17T17:30:00Z" },
      NOW,
    );
    expect(note).toContain("18");
    expect(note).toContain("01:30");
  });

  it("a due time already past means the scheduler's next tick, not a missed run", () => {
    expect(
      nextRunNote(vi, "vi", { cadence: "hourly", nextRunAt: "2026-09-17T11:00:00Z" }, NOW),
    ).toBe("Ở lượt kế tiếp, trong vòng 15 phút");
  });

  it("paused says so; no due time at all is missing", () => {
    expect(nextRunNote(en, "en", { cadence: "paused", nextRunAt: null }, NOW)).toBe(
      "Not while paused",
    );
    expect(nextRunNote(en, "en", { cadence: "daily", nextRunAt: null }, NOW)).toBe("—");
  });
});

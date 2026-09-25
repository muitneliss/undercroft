/**
 * The one schedule rule, asked from both sides: what runs, what never does, and when -- and
 * which cron expressions it will agree to keep.
 */

import { describe, expect, test as it } from "bun:test";

import {
  cadenceSetting,
  checkCron,
  isDue,
  nextRunAt,
  type ScheduleFacts,
  upcomingFires,
} from "./cadence.ts";

const NOW = new Date("2026-03-01T10:00:00.000Z");
const GMAIL_SCOPE = JSON.stringify({ labels: [{ id: "Label_8", name: "Invoices" }] });

function facts(over: Partial<ScheduleFacts> = {}): ScheduleFacts {
  return {
    source: "hubspot",
    status: "connected",
    cadence: "daily",
    cron: null,
    selectionJson: "{}",
    lastRunStartedAt: "2026-03-01T02:00:00.000Z",
    ...over,
  };
}

describe("nextRunAt", () => {
  it("is the last start plus the cadence", () => {
    expect(nextRunAt(facts({ cadence: "hourly" }), NOW)).toBe("2026-03-01T03:00:00.000Z");
    expect(nextRunAt(facts({ cadence: "every_6h" }), NOW)).toBe("2026-03-01T08:00:00.000Z");
    expect(nextRunAt(facts({ cadence: "daily" }), NOW)).toBe("2026-03-02T02:00:00.000Z");
  });

  it("a pair that has never run is due now", () => {
    expect(nextRunAt(facts({ lastRunStartedAt: null }), NOW)).toBe(NOW.toISOString());
  });

  it("paused, disconnected, and a scoped source with no scope chosen never run", () => {
    expect(nextRunAt(facts({ cadence: "paused" }), NOW)).toBeNull();
    expect(nextRunAt(facts({ status: "expired" }), NOW)).toBeNull();
    expect(nextRunAt(facts({ source: "gmail", selectionJson: "{}" }), NOW)).toBeNull();
  });

  it("a scoped source with its scope chosen runs like any other", () => {
    // The quiet side of the scope guard.
    expect(nextRunAt(facts({ source: "gmail", selectionJson: GMAIL_SCOPE }), NOW)).toBe(
      "2026-03-02T02:00:00.000Z",
    );
  });
});

describe("isDue", () => {
  it("fires once the gap has passed and stays quiet before it", () => {
    const hourly = facts({ cadence: "hourly", lastRunStartedAt: "2026-03-01T09:30:00.000Z" });
    expect(isDue({ ...hourly, lastRunStatus: "ok" }, NOW)).toBe(false);
    expect(isDue({ ...hourly, lastRunStatus: "ok" }, new Date("2026-03-01T10:30:00.000Z"))).toBe(
      true,
    );
  });

  it("a failed run is retried at the next gap, a running one is never asked for twice", () => {
    const due = facts({ cadence: "hourly" });
    expect(isDue({ ...due, lastRunStatus: "failed" }, NOW)).toBe(true);
    expect(isDue({ ...due, lastRunStatus: "running" }, NOW)).toBe(false);
  });
});

describe("a custom cadence", () => {
  // 07:30 on weekdays, Singapore time: 23:30Z the evening before. 2026-03-01 is a Sunday.
  const weekdays = facts({ cadence: "custom", cron: "30 7 * * 1-5" });

  it("is due at the first fire after the last run started, read in Singapore time", () => {
    // Last ran Friday 07:30 SGT; the next fire is Monday 07:30 SGT, not Saturday.
    expect(nextRunAt({ ...weekdays, lastRunStartedAt: "2026-02-26T23:30:04.000Z" }, NOW)).toBe(
      "2026-03-01T23:30:00.000Z",
    );
  });

  it("catches up a missed fire exactly once, and never replays the rest", () => {
    // Down from Monday to Thursday: four fires missed. The first one after the last start is
    // in the past, so the pair is due now; once that run starts, the next is Friday's.
    const thursday = new Date("2026-03-05T02:00:00.000Z");
    const stale = { ...weekdays, lastRunStartedAt: "2026-02-26T23:30:04.000Z" };
    expect(isDue({ ...stale, lastRunStatus: "ok" }, thursday)).toBe(true);
    const caughtUp = { ...weekdays, lastRunStartedAt: thursday.toISOString() };
    expect(nextRunAt(caughtUp, thursday)).toBe("2026-03-05T23:30:00.000Z");
    expect(isDue({ ...caughtUp, lastRunStatus: "ok" }, thursday)).toBe(false);
  });

  it("a pair that has never run is due now, as with a preset", () => {
    expect(nextRunAt({ ...weekdays, lastRunStartedAt: null }, NOW)).toBe(NOW.toISOString());
  });

  it("a stored expression that no longer parses runs nothing, even never having run", () => {
    // A defect, not a schedule: no guessed next run, and never due.
    for (const cron of ["30 7 * * 1-5 *", "not a cron", null]) {
      expect(nextRunAt({ ...weekdays, cron, lastRunStartedAt: null }, NOW)).toBeNull();
      expect(nextRunAt({ ...weekdays, cron }, NOW)).toBeNull();
    }
  });
});

describe("checkCron", () => {
  it("keeps a five-field expression, stored with single spaces", () => {
    expect(checkCron("  30 7  * * 1-5 ")).toEqual({ ok: true, cron: "30 7 * * 1-5" });
    // Every five minutes is exactly one tick apart, which the scheduler can keep.
    expect(checkCron("*/5 * * * *")).toEqual({ ok: true, cron: "*/5 * * * *" });
  });

  it("refuses with a reason a caller can word", () => {
    expect(checkCron("")).toEqual({ ok: false, reason: "fields" });
    expect(checkCron("0 30 7 * * 1-5")).toEqual({ ok: false, reason: "fields" });
    expect(checkCron("@daily")).toEqual({ ok: false, reason: "fields" });
    expect(checkCron("61 7 * * *")).toEqual({ ok: false, reason: "invalid" });
    // `?` would be read as "whatever time it is now", a different schedule on every read.
    expect(checkCron("? 7 * * *")).toEqual({ ok: false, reason: "invalid" });
    expect(checkCron("0 9 31 2 *")).toEqual({ ok: false, reason: "never" });
  });

  it("refuses fires closer together than one tick, across midnight too", () => {
    expect(checkCron("*/4 * * * *")).toEqual({ ok: false, reason: "too-frequent" });
    expect(checkCron("0,3 9 * * *")).toEqual({ ok: false, reason: "too-frequent" });
    // 23:58 then 00:02 the next day: four minutes, which only a sample across midnight sees.
    expect(checkCron("58,2 23,0 * * *")).toEqual({ ok: false, reason: "too-frequent" });
  });
});

describe("upcomingFires", () => {
  it("lists the next fires in Singapore time, and nothing for an expression that cannot run", () => {
    expect(upcomingFires("0 9 * * *", NOW, 2)).toEqual([
      "2026-03-02T01:00:00.000Z",
      "2026-03-03T01:00:00.000Z",
    ]);
    expect(upcomingFires("0 9 * *", NOW, 2)).toEqual([]);
  });
});

describe("cadenceSetting", () => {
  it("a preset carries no expression, and a custom one carries the checked expression", () => {
    expect(cadenceSetting({ cadence: "hourly" })).toEqual({
      ok: true,
      setting: { cadence: "hourly", cron: null },
    });
    expect(cadenceSetting({ cadence: "custom", cron: "0  9 * * *" })).toEqual({
      ok: true,
      setting: { cadence: "custom", cron: "0 9 * * *" },
    });
  });

  it("refuses custom without a valid expression, and a preset sent with one", () => {
    expect(cadenceSetting({ cadence: "custom" })).toEqual({
      ok: false,
      reason: "cron-refused",
      refusal: "fields",
    });
    expect(cadenceSetting({ cadence: "custom", cron: "* * * * *" })).toEqual({
      ok: false,
      reason: "cron-refused",
      refusal: "too-frequent",
    });
    // A caller who sent both believes a cron was saved; keeping the preset would be a guess.
    expect(cadenceSetting({ cadence: "daily", cron: "0 9 * * *" })).toEqual({
      ok: false,
      reason: "cron-without-custom",
    });
  });
});

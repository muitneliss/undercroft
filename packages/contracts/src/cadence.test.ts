/**
 * The one schedule rule, asked from both sides: what runs, what never does, and when.
 */

import { describe, expect, test as it } from "bun:test";

import { isDue, nextRunAt, type ScheduleFacts } from "./cadence.ts";

const NOW = new Date("2026-03-01T10:00:00.000Z");
const GMAIL_SCOPE = JSON.stringify({ labels: [{ id: "Label_8", name: "Invoices" }] });

function facts(over: Partial<ScheduleFacts> = {}): ScheduleFacts {
  return {
    source: "hubspot",
    status: "connected",
    cadence: "daily",
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

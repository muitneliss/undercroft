/**
 * What the fold promises: a reading never becomes a line, a line never becomes a reading,
 * and a run recorded before `live` existed reads the same way as one recorded after it.
 */

import { describe, expect, test as it } from "bun:test";

import type { RunDetail, RunEventView } from "@/api/types.ts";
import { translatorFor } from "@/i18n/index.ts";
import { MISSING } from "@/lib/money.ts";
import {
  feedEntries,
  gaugeFigure,
  gaugeShare,
  isReading,
  type RunGauge,
  runGauges,
} from "@/lib/runFeed.ts";
import { runDetail } from "@/test/fixtures.ts";

const en = translatorFor("en");
const vi = translatorFor("vi");

function event(
  name: string,
  detail: Record<string, unknown>,
  entity: string | null = null,
  over: Partial<RunEventView> = {},
): RunEventView {
  return {
    at: "2026-09-19T12:42:22.000Z",
    level: "info",
    event: name,
    entity,
    detail,
    live: false,
    ...over,
  };
}

const RUNNING: RunDetail = runDetail({ status: "running", counts: null, endedAt: null });

describe("which lines are readings", () => {
  it("a line the worker marked live is a reading, whatever it is called", () => {
    expect(isReading(event("anything_at_all", {}, null, { live: true }))).toBe(true);
  });

  it("a milestone is not, and neither is a warning that names an entity", () => {
    expect(isReading(event("entity_started", {}, "messages"))).toBe(false);
    expect(isReading(event("events_truncated", { at: 200 }, null, { level: "warn" }))).toBe(false);
  });

  it("a progress line recorded before the column existed is still a reading", () => {
    // Every `records_read` row in the ledger from before ADR 0032 carries `live: false`,
    // and a run from last month must not print two hundred of them as lines.
    expect(isReading(event("records_read", { read: 5 }, "messages"))).toBe(true);
  });
});

describe("the ledger", () => {
  it("keeps the milestones, in order, and none of the readings", () => {
    const entries = feedEntries([
      event("run_opened", {}),
      event("records_read", { read: 5 }, "messages"),
      event("records_read", { read: 900 }, "messages", { live: true }),
      event("entity_done", { landed: 900 }, "messages"),
    ]);

    expect(entries.map((e) => e.event)).toEqual(["run_opened", "entity_done"]);
  });

  it("a run that only ever read is a ledger with nothing in it, not a ledger of one line repeated", () => {
    const readings = [5, 10, 15, 20].map((read) =>
      event("records_read", { read }, "messages", { live: true }),
    );

    expect(feedEntries(readings)).toEqual([]);
  });
});

describe("the dials", () => {
  it("an entity being read has one gauge, carrying the newest figure and its total", () => {
    const [gauge] = runGauges(RUNNING, [
      event("entity_started", {}, "messages"),
      event("work_listed", { total: 7786 }, "messages"),
      event("records_read", { read: 5 }, "messages"),
      event("records_read", { read: 928 }, "messages"),
    ]);

    expect(gauge?.entity).toBe("messages");
    expect(gauge?.read).toBe(928);
    expect(gauge?.total).toBe(7786);
    expect(gauge?.share).toBeCloseTo(928 / 7786, 6);
  });

  it("an entity that finished has no dial left to watch", () => {
    const gauges = runGauges(RUNNING, [
      event("entity_started", {}, "messages"),
      event("records_read", { read: 928 }, "messages"),
      event("entity_done", { landed: 928, refused: 0 }, "messages"),
    ]);

    expect(gauges).toEqual([]);
  });

  it("a closed run has none either, whatever its last reading said", () => {
    const closed = runDetail({ status: "ok" });
    const gauges = runGauges(closed, [
      event("entity_started", {}, "messages"),
      event("records_read", { read: 928 }, "messages"),
    ]);

    expect(gauges).toEqual([]);
  });

  it("a total nobody stated is not invented: there is a count and no share", () => {
    // `runPaths.ts` reads a stream and counts as it goes; no connector spec states a total.
    const [gauge] = runGauges(RUNNING, [
      event("entity_started", {}, "deals"),
      event("records_read", { read: 412 }, "deals"),
    ]);

    expect(gauge?.total).toBeNull();
    expect(gauge?.share).toBeNull();
  });

  it("a reading that ran a step ahead of its total is held at full rather than overflowing", () => {
    // Gmail writes the reading BEFORE fetching the message it is about, so at a page
    // boundary `read` can briefly match or pass `total`.
    const [gauge] = runGauges(RUNNING, [
      event("entity_started", {}, "messages"),
      event("work_listed", { total: 10 }, "messages"),
      event("records_read", { read: 12 }, "messages"),
    ]);

    expect(gauge?.share).toBe(1);
  });
});

describe("what a gauge says", () => {
  const reading: RunGauge = { entity: "messages", read: 928, total: 7786, share: 928 / 7786 };

  it("prints both figures in the reader's own grouping", () => {
    expect(gaugeFigure("vi", reading)).toBe("928 / 7.786");
    expect(gaugeFigure("en", reading)).toBe("928 / 7,786");
  });

  it("floors the share, so it cannot read whole with work still to do", () => {
    const nearly: RunGauge = { entity: "messages", read: 999, total: 1000, share: 0.999 };

    expect(gaugeShare(en, "en", nearly)).toBe("99%");
    expect(gaugeShare(vi, "vi", nearly)).toBe("99%");
  });

  it("has no share to print where there is no total, and prints the count alone", () => {
    const counting: RunGauge = { entity: "deals", read: 412, total: null, share: null };

    expect(gaugeShare(en, "en", counting)).toBeNull();
    expect(gaugeFigure("en", counting)).toBe("412");
  });

  it("an absent count is a dash, never a zero", () => {
    const nothing: RunGauge = { entity: "deals", read: null, total: null, share: null };

    expect(gaugeFigure("en", nothing)).toBe(MISSING);
  });
});

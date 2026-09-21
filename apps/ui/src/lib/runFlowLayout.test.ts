/**
 * What the row's layout promises: a plate is as wide as its own longest line, plates never
 * overlap, and the ends of the row know they are ends.
 *
 * The width rule is the regression this module exists for -- every plate used to be a fixed
 * 204px, which cramped a chain link's sentence into the same box as the word "files".
 */

import { describe, expect, test as it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { railPlan, STATION_GAP, STATION_HEIGHT, stationWidth } from "@/lib/runFlowLayout.ts";
import type { RunStage } from "@/lib/runFlowTypes.ts";

function stage(over: Partial<RunStage> = {}): RunStage {
  return {
    key: "entity:files",
    kind: "entity",
    label: "files",
    mark: "granted",
    markLabel: "Done",
    detail: "0 records",
    gathered: null,
    href: null,
    ...over,
  };
}

describe("how wide a plate is", () => {
  it("grows with the longest line it has to print", () => {
    const short = stationWidth(stage({ label: "files", detail: null, markLabel: "Done" }));
    const long = stationWidth(stage({ label: "Chained into a model build", detail: null }));

    expect(long).toBeGreaterThan(short);
  });

  it("stops growing, so one long stage cannot push the row off the leaf", () => {
    const long = stationWidth(stage({ label: "a".repeat(80) }));
    const longer = stationWidth(stage({ label: "a".repeat(400) }));

    expect(longer).toBe(long);
  });

  it("is driven by the datum too, not only by the name", () => {
    const bare = stationWidth(stage({ label: "x", markLabel: "x", detail: null }));
    const evidenced = stationWidth(
      stage({ label: "x", markLabel: "x", detail: "1,204,338 records · 12 refused" }),
    );

    expect(evidenced).toBeGreaterThan(bare);
  });
});

describe("where the plates sit", () => {
  it("places each one clear of the last, with the connection between them", () => {
    const stations = railPlan([
      stage({ key: "a", label: "files" }),
      stage({ key: "b", label: "Chained into a model build" }),
      stage({ key: "c", label: "documents" }),
    ]);

    expect(stations.map((s) => s.place)).toEqual(["first", "middle", "last"]);
    for (const [index, station] of stations.entries()) {
      const previous = stations[index - 1];
      if (previous !== undefined) {
        expect(station.x).toBe(previous.x + previous.width + STATION_GAP);
      }
    }
  });

  // Which matters because `place` is what hides a connector wired to nothing, and a lone
  // plate has nothing arriving AND nothing leaving.
  it("calls a lone plate both ends at once", () => {
    expect(railPlan([stage()]).map((s) => s.place)).toEqual(["only"]);
  });
});

/**
 * The stylesheet sizes the canvas and this module sizes the nodes inside it. If they drift
 * the plates are clipped or float in a band of empty board -- a defect that typechecks,
 * lints and passes every other test in the suite, because nothing else reads both sides.
 */
describe("the geometry the stylesheet draws with", () => {
  const sheet = readFileSync(join(import.meta.dir, "..", "index.css"), "utf8");

  it("agrees with this module about how tall a plate is", () => {
    const found = /--station-h:\s*(?<px>\d+)px/u.exec(sheet);
    expect(found?.groups?.px).toBe(String(STATION_HEIGHT));
  });
});

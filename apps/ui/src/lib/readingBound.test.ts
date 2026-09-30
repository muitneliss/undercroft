/**
 * What a gauge or progress bar promises: it draws a share only against the bound its author
 * set -- never against the largest value or 100 -- and a missing reading draws no share.
 */

import { describe, expect, test as it } from "bun:test";
import { ChartConfig } from "@undercroft/contracts/bi";

import { readingShare } from "./readingBound.ts";

describe("readingShare", () => {
  it("draws no share when the author set no bound, whatever the reading", () => {
    for (const type of ["gauge", "progress"] as const) {
      expect(readingShare(40, ChartConfig.parse({ type }))).toEqual({ kind: "noBound" });
      expect(readingShare(40, ChartConfig.parse({ type, options: { max: 0 } }))).toEqual({
        kind: "noBound",
      });
    }
  });

  it("draws the reading against the author's bound, and nothing for a missing reading", () => {
    const chart = ChartConfig.parse({ type: "gauge", options: { max: 200 } });
    expect(readingShare(40, chart)).toEqual({ kind: "share", value: 40, max: 200 });
    expect(readingShare(null, chart)).toEqual({ kind: "noValue" });
  });
});

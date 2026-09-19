/**
 * What the palette promises: every categorical slot is a visible mark on the leaf (3:1,
 * WCAG 2.1's floor for a graphical object), none of them is the errata vermilion, and the
 * order is stable so a chart's first series is the same colour on every screen.
 */

import { describe, expect, test as it } from "bun:test";

import { contrast, parseHex } from "./acetate.ts";
import { CATEGORICAL, colourFor, OTHER, sequential } from "./plotPalette.ts";

const LEAF = "#fbf8f0";
const ERRATA = "#cf2f16";
/** WCAG 2.1 SC 1.4.11: a graphical object against its background. */
const FLOOR = 3;

function ratio(hex: string): number {
  const colour = parseHex(hex);
  const leaf = parseHex(LEAF);
  if (colour === null || leaf === null) {
    throw new Error(`unreadable colour ${hex}`);
  }
  return contrast(colour, leaf);
}

describe("plotPalette", () => {
  it("every slot clears the floor on the leaf, and none is the errata vermilion", () => {
    for (const hex of [...CATEGORICAL, OTHER]) {
      expect(ratio(hex)).toBeGreaterThanOrEqual(FLOOR);
      expect(hex.toLowerCase()).not.toBe(ERRATA);
    }
  });

  it("the order is stable and cycles past the end", () => {
    expect(CATEGORICAL).toHaveLength(7);
    expect(colourFor(0)).toBe(CATEGORICAL[0] ?? "");
    expect(colourFor(7)).toBe(CATEGORICAL[0] ?? "");
    expect(sequential(3)).toHaveLength(3);
    expect(sequential(1)).toEqual(["#173570"]);
  });
});

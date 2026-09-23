import { describe, expect, test as it } from "bun:test";

import {
  clampSize,
  GRIP_STEP,
  lengthInPx,
  type SizeLimits,
  sizeFromDrag,
  sizeFromKey,
  travelShare,
} from "./dragSize.ts";

/** The editor pane's own: 9rem of floor, 72% of a 1000px window of ceiling. */
const PANE: SizeLimits = { min: 144, max: 720 };
const OPEN: SizeLimits = { min: null, max: null };

describe("a draggable edge", () => {
  it("follows the pointer, and returns to where it started exactly", () => {
    const origin = { size: 272, at: 500 };
    expect(sizeFromDrag(origin, 560, PANE)).toBe(332);
    expect(sizeFromDrag(origin, 440, PANE)).toBe(212);
    // The property a drag-and-think-better-of-it rests on: no rounding drift on the way out
    // and back, so a pane returns to the measure it was at rather than to a pixel beside it.
    expect(sizeFromDrag(origin, 500, PANE)).toBe(272);
  });

  it("stops at the floor and the ceiling the sheet declares, and runs free where it declares none", () => {
    expect(sizeFromDrag({ size: 272, at: 500 }, 0, PANE)).toBe(144);
    expect(sizeFromDrag({ size: 272, at: 500 }, 9000, PANE)).toBe(720);
    expect(sizeFromDrag({ size: 272, at: 500 }, 9000, OPEN)).toBe(8772);
  });

  it("obeys a ceiling written below its own floor, which is how the fold folds a dragged rail", () => {
    // `.rail-ref--folded` clamps `max-width` to the spine while `min-width` is still 11rem.
    expect(clampSize(480, { min: 176, max: 44 })).toBe(44);
  });

  it("answers its own axis's arrows and leaves the other axis's alone", () => {
    const inline = { axis: "inline" as const, size: 272, limits: PANE, step: GRIP_STEP };
    expect(sizeFromKey("ArrowRight", inline)).toBe(288);
    expect(sizeFromKey("ArrowLeft", inline)).toBe(256);
    expect(sizeFromKey("ArrowDown", inline)).toBeNull();

    const block = { axis: "block" as const, size: 272, limits: PANE, step: GRIP_STEP };
    expect(sizeFromKey("ArrowDown", block)).toBe(288);
    expect(sizeFromKey("ArrowUp", block)).toBe(256);
    expect(sizeFromKey("ArrowRight", block)).toBeNull();

    // Escape cancels a drag, which is the hand's business and not the arithmetic's.
    expect(sizeFromKey("Escape", block)).toBeNull();
    expect(sizeFromKey("a", block)).toBeNull();
  });

  it("sends Home and End to the sheet's own ends, and nowhere at all where it declares none", () => {
    const at = { axis: "block" as const, size: 272, limits: PANE, step: GRIP_STEP };
    expect(sizeFromKey("Home", at)).toBe(144);
    expect(sizeFromKey("End", at)).toBe(720);
    expect(sizeFromKey("Home", { ...at, limits: OPEN })).toBeNull();
    expect(sizeFromKey("End", { ...at, limits: OPEN })).toBeNull();
  });

  it("reads a computed length in px or as a share of its basis, and nothing from a keyword", () => {
    expect(lengthInPx("144px", 1000)).toBe(144);
    // The editor pane's ceiling, which a browser hands back unresolved.
    expect(lengthInPx("72%", 1000)).toBe(720);
    expect(lengthInPx("none", 1000)).toBeNull();
    expect(lengthInPx("auto", 1000)).toBeNull();
    expect(lengthInPx("", 1000)).toBeNull();
  });

  it("reports where along its travel it sits, and says nothing where an end is open", () => {
    expect(travelShare(144, PANE)).toBe(0);
    expect(travelShare(720, PANE)).toBe(100);
    expect(travelShare(432, PANE)).toBe(50);
    expect(travelShare(9000, PANE)).toBe(100);
    expect(travelShare(272, { min: 144, max: null })).toBeNull();
    expect(travelShare(272, { min: 144, max: 144 })).toBeNull();
  });
});

/**
 * The contrast guarantee, over every board in the wheel.
 *
 * This is the promise that lets the design put a reading field over a saturated
 * divider board at all. If it breaks, a form set on the ultramarine or sienna
 * section becomes unreadable -- and it would break silently, because the solver
 * runs at paint time and nothing else in the stack measures the result.
 *
 * The case that actually bites is a new division: someone adds a fifth section,
 * takes the next hue off the wheel, and never checks it. So the test walks the
 * whole wheel rather than the four hues in use today, and includes the two
 * extremes a hand-picked alpha would fail on.
 */

// biome-ignore-all lint/nursery/useExplicitType: The 50 sites whose type the compiler could print are annotated. What is left is parameters of callbacks passed to third-party APIs -- Better Auth's hooks, tRPC's builders -- where the type is supplied contextually and writing it out means naming a library-internal type that will drift on the next upgrade.
// biome-ignore-all lint/style/noNonNullAssertion: Almost all of these are tests asserting on a fixture they created three lines earlier, which the ESLint config this replaced also exempted for the same reason. Biome's unsafe autofix for the rule deletes the `!` and leaves `string | undefined` flowing into a `string`, so it does not compile.

import { describe, expect, test as it } from "bun:test";

import { DIVISIONS } from "@/lib/divisions.ts";
import {
  composite,
  contrast,
  INK,
  letteringOn,
  PAPER,
  parseHex,
  solveLeaf,
  TARGET_CONTRAST,
} from "./acetate.ts";

const LEAF = PAPER;

/** Every hue in the wheel, including the three no division has claimed. */
const WHEEL = ["#b24b1a", "#eda600", "#3e782b", "#0f7673", "#234c9e", "#634cb0", "#7f4023"];

describe("solveLeaf", () => {
  it("every hue in the wheel yields a readable field", () => {
    for (const hue of WHEEL) {
      const board = parseHex(hue);
      expect(board).not.toBeNull();

      const solved = solveLeaf(LEAF, board!, INK);
      const field = composite(LEAF, board!, solved.alpha);

      expect(contrast(field, INK)).toBeGreaterThanOrEqual(TARGET_CONTRAST);
    }
  });

  it("every division's board yields a readable field", () => {
    // The wheel above is a literal; this walks what the app actually renders, so
    // a division pointing at a hue that is not on the wheel is caught too.
    for (const div of DIVISIONS) {
      const board = parseHex(div.hue);
      const solved = solveLeaf(LEAF, board!, INK);

      expect(contrast(composite(LEAF, board!, solved.alpha), INK)).toBeGreaterThanOrEqual(
        TARGET_CONTRAST,
      );
    }
  });

  it("a dark board needs more coverage than a light one", () => {
    // The whole reason the alpha is solved rather than chosen. If these ever
    // come out equal, the solver has stopped solving and is returning a
    // constant, which no contrast assertion above would notice.
    const ultramarine = solveLeaf(LEAF, parseHex("#234c9e")!, INK);
    const chrome = solveLeaf(LEAF, parseHex("#eda600")!, INK);

    expect(ultramarine.alpha).toBeGreaterThan(chrome.alpha);
  });

  it("it spends the contrast budget rather than hoarding it", () => {
    // Lowest alpha that clears the target, not a safe one: acetate whose board
    // never shows through is just paper. A shade less coverage must fail.
    const board = parseHex("#0f7673")!;
    const solved = solveLeaf(LEAF, board, INK);

    expect(contrast(composite(LEAF, board, solved.alpha - 0.02), INK)).toBeLessThan(
      TARGET_CONTRAST,
    );
  });

  it("an unreachable target reports what it actually achieved", () => {
    // Against a white ink nothing can reach 10:1. Returning full coverage and
    // the real figure is the honest answer; silently returning an alpha that
    // misses the target would hide a broken palette.
    const white = { r: 255, g: 255, b: 255 };
    const solved = solveLeaf(LEAF, parseHex("#eda600")!, white);

    expect(solved.alpha).toBe(1);
    expect(solved.contrast).toBeLessThan(TARGET_CONTRAST);
  });
});

describe("letteringOn", () => {
  it("every tab in the wheel is legibly lettered", () => {
    // The rail shipped white-on-everything until this was measured: white on the
    // chrome board is 2.09:1. A division added later must not reintroduce that.
    for (const hue of WHEEL) {
      const board = parseHex(hue);
      const lettering = parseHex(letteringOn(hue));

      expect(contrast(board!, lettering!)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("every division's tab is legibly lettered", () => {
    for (const div of DIVISIONS) {
      const board = parseHex(div.hue);
      const lettering = parseHex(letteringOn(div.hue));

      expect(contrast(board!, lettering!)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("a light board takes ink and a dark board takes paper", () => {
    // If both ever came back the same, the function has stopped choosing and the
    // contrast assertions above would still pass on whichever half it favours.
    expect(letteringOn("#eda600")).not.toBe(letteringOn("#234c9e"));
  });
});

describe("parseHex", () => {
  it("refuses a value it cannot read rather than guessing one", () => {
    // A board hue that silently became black would produce a page that is
    // legible and wrong, which is the failure this codebase exists to avoid.
    expect(parseHex("not a colour")).toBeNull();
    expect(parseHex("#12345")).toBeNull();
    expect(parseHex("")).toBeNull();
  });

  it("reads both short and long form", () => {
    expect(parseHex("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex("#234c9e")).toEqual({ r: 35, g: 76, b: 158 });
  });
});

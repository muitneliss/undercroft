/**
 * A grid wider than its pane says so -- the one half of that promise a machine can see.
 *
 * THE DEFECT. `.result` is a scroll container: eight columns of a lake query are wider than
 * any pane this book has, so the grid scrolls sideways. On macOS a browser left to draw its
 * own scrollbar draws an OVERLAY one, painted only while the reader is already scrolling, so
 * the grid read as a table that had simply run out of columns -- nothing on the screen said
 * anything continued to the right. Sizing `::-webkit-scrollbar` is what switches Blink and
 * WebKit to a classic bar that is always painted and takes the space it needs, and the sheet
 * has carried those rules since the beginning.
 *
 * WHAT TURNED THEM OFF. Since Chrome 121, `scrollbar-width` or `scrollbar-color` on an
 * element makes the engine ignore `::-webkit-scrollbar` for that element entirely. Four
 * surfaces carried `scrollbar-width: thin` under a comment saying they wore the sheet's own
 * hairline scrollbar; what they actually wore was the platform's, which is to say nothing.
 * The declaration that reads as a refinement is the one that removes the affordance.
 *
 * WHY IT IS PINNED HERE. Every other check in this repo is green either way: a grid with no
 * scrollbar renders perfectly, typechecks perfectly, and its rows are all correct. The only
 * evidence is a reserved 12px along the foot of a box in a real browser, which no offline
 * gate can measure -- so what is asserted is the sheet's own text, from both sides: the
 * pseudo-element is sized on BOTH axes, and the two standard properties appear nowhere
 * outside the `@supports` that exists for engines with no pseudo to size.
 *
 * Measured in Chrome 152 against this sheet: a box carrying only the pseudo reserves 12px for
 * a horizontal bar; the same box with `scrollbar-width: thin` beside it reserves none.
 *
 * No Docker, no network.
 */

import { describe, expect, test as it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SHEET = join(import.meta.dirname, "..", "apps", "ui", "src", "index.css");

/** The one at-rule the standard properties belong in, spelled exactly as the sheet spells it. */
const FALLBACK = "@supports not selector(::-webkit-scrollbar)";

function withoutComments(css: string): string {
  return css.replaceAll(/\/\*[\s\S]*?\*\//gu, "");
}

/**
 * The sheet with the Gecko fallback cut out of it, by brace depth.
 *
 * Cutting rather than allow-listing line numbers: what is being asked is "does a standard
 * scrollbar property reach an engine that has the pseudo", and the fallback is the one place
 * it cannot. A regex that merely skipped the nearest `}` would stop at the first nested rule.
 */
function outsideTheFallback(css: string): string {
  const bare = withoutComments(css);
  const at = bare.indexOf(FALLBACK);
  if (at === -1) {
    return bare;
  }
  let cursor = bare.indexOf("{", at) + 1;
  let depth = 1;
  while (depth > 0) {
    const char = bare[cursor];
    depth += char === "{" ? 1 : char === "}" ? -1 : 0;
    cursor += 1;
  }
  return bare.slice(0, at) + bare.slice(cursor);
}

/** Every `scrollbar-width` / `scrollbar-color` declaration in a sheet, as written. */
function standardProperties(css: string): string[] {
  return [...css.matchAll(/scrollbar-(?:width|color)\s*:[^;}]*/gu)].map((found) => found[0].trim());
}

/** One declaration block's body, by selector. Flat blocks, which is what this sheet is. */
function blockBody(css: string, selector: string): string {
  const bare = withoutComments(css);
  const at = bare.indexOf(`${selector} {`);
  expect(at).toBeGreaterThan(-1);
  return bare.slice(bare.indexOf("{", at) + 1, bare.indexOf("}", at));
}

describe("the sheet draws its own scrollbars", () => {
  const css = readFileSync(SHEET, "utf8");

  it("sizes the horizontal bar, not only the vertical one", () => {
    // `width` alone leaves a grid too wide for its pane exactly where it started: the bar
    // that would have said so is the one along the foot.
    const body = blockBody(css, "::-webkit-scrollbar");
    expect(body).toContain("height:");
    expect(body).toContain("width:");
  });

  it("keeps the standard properties away from engines that have the pseudo", () => {
    expect(standardProperties(outsideTheFallback(css))).toEqual([]);
  });

  it("still answers Gecko, which has no pseudo to size", () => {
    expect(css).toContain(FALLBACK);
    expect(standardProperties(withoutComments(css)).length).toBeGreaterThan(0);
  });
});

describe("the reading of a sheet is itself pinned", () => {
  // A check that cannot fail is not a check. These two are the same declaration in the two
  // places it can be written, so "the sheet is clean" is evidence rather than an artefact of
  // a regex that matches nothing.
  const INSIDE = `::-webkit-scrollbar { height: 12px; }
    ${FALLBACK} {
      * { scrollbar-width: thin; scrollbar-color: red blue; }
    }`;
  const OUTSIDE = `${INSIDE}
    .result { overflow: auto; scrollbar-width: thin; }`;

  it("reads a sheet that answers Gecko alone as clean", () => {
    expect(standardProperties(outsideTheFallback(INSIDE))).toEqual([]);
  });

  it("catches the same declaration written on a scroll container", () => {
    expect(standardProperties(outsideTheFallback(OUTSIDE))).toEqual(["scrollbar-width: thin"]);
  });
});

/**
 * A control sits on its field's line -- the stylesheet half of that promise.
 *
 * `.ast-grep/rules/row-field-alignment.yml` refuses a `.field` written into a bare `.row`
 * and sends the author to `.row--field`. That refusal is worth nothing if the class it
 * names has stopped aligning anything, and nothing else in the gate would notice: a button
 * hanging half a caption above the box it submits renders perfectly, typechecks perfectly
 * and passes every other test in this repo. `scripts/alignment.test.ts` pins the rule;
 * this pins what the rule sends you to. docs/adr/0027.
 *
 * It asks for the COMPUTED value off the real `index.css` rather than grepping the file for
 * a string, so a rule that is present but overridden fails here. The sheet's rules live
 * inside `@layer undercroft`, which happy-dom's CSSOM drops whole, so the layer's body is
 * unwrapped before injection -- the same declarations, one nesting level up.
 *
 * The `:has(> .field)` net beside the class -- for a field arriving from a child component
 * or a `.map`, where no linter can follow it -- is NOT asserted here: happy-dom's selector
 * engine does not implement `:has()` at this version, so a computed value would be evidence
 * of nothing rather than evidence of absence. `scripts/alignment.test.ts` pins it
 * structurally instead, by requiring it in the same block as the class.
 */

import { beforeAll, describe, expect, test as it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SHEET = join(import.meta.dirname, "index.css");

/** The `@layer <name> { ... }` body, by brace depth. */
function layerBody(css: string, name: string): string {
  const start = css.indexOf("{", css.indexOf(`@layer ${name} {`)) + 1;
  let depth = 1;
  let at = start;
  while (depth > 0) {
    const char = css[at];
    depth += char === "{" ? 1 : char === "}" ? -1 : 0;
    at += 1;
  }
  return css.slice(start, at - 1);
}

function render(markup: string): Element {
  document.body.innerHTML = markup;
  const first = document.body.firstElementChild;
  if (first === null) {
    throw new Error("the fixture rendered nothing");
  }
  return first;
}

/** The row the lake's search band is, and every other field-and-button pair in the app. */
const PAIR = `<div class="row row--field">
  <label class="field"><span class="label">Keyword</span><input class="input" /></label>
  <button class="plate">Search</button>
</div>`;

beforeAll(() => {
  const style = document.createElement("style");
  style.textContent = layerBody(readFileSync(SHEET, "utf8"), "undercroft");
  document.head.append(style);
});

describe("a row carrying a labelled field", () => {
  it("aligns its items to the field's bottom edge, not the row's centre", () => {
    expect(globalThis.getComputedStyle(render(PAIR)).alignItems).toBe("flex-end");
  });

  it("gives the input and the plate beside it one height", () => {
    const row = render(PAIR);
    const input = globalThis.getComputedStyle(row.querySelector(".input") as Element);
    const plate = globalThis.getComputedStyle(row.querySelector(".plate") as Element);
    expect(input.minHeight).not.toBe("");
    expect(plate.minHeight).toBe(input.minHeight);
  });

  it("leaves a small plate its own height: it is small on purpose", () => {
    const row = render(PAIR.replace(`class="plate"`, `class="plate plate--small"`));
    expect(globalThis.getComputedStyle(row.querySelector(".plate") as Element).minHeight).toBe("");
  });
});

describe("a row carrying only plates", () => {
  it("is still centred, which is what .row's centring is for", () => {
    const row = render(`<div class="row"><button class="plate">One</button></div>`);
    expect(globalThis.getComputedStyle(row).alignItems).toBe("center");
  });
});

/**
 * The ledger's two columns are two things, and a reader has to be able to see that they are.
 *
 * The gutter between them used to be the instant column's own `padding-right` -- on the one
 * cell this sheet deliberately shrinks to its content (`width: 1%`). Under the sheet's
 * `box-sizing: border-box` that is a padding INSIDE the width being minimised, so whether a
 * reader is ever given it is the engine's shrink-to-fit talking, and one reported the line set
 * as `11:33:38Bắt đầu.`, one word. It now belongs to the column the table is free to stretch,
 * where nothing can squeeze it. That is a fact about this sheet and about no markup, so it is
 * invisible to every other check in the gate.
 */
describe("the ledger's instant column", () => {
  const LINE = `<div class="feed__region"><table class="table"><tbody><tr>
    <td class="datum datum--quiet">11:33:38</td><td><span class="feed__what">Bắt đầu.</span></td>
  </tr></tbody></table></div>`;

  it("leaves the gutter to the sentence beside it, not to its own squeezable padding", () => {
    const region = render(LINE);
    const instant = globalThis.getComputedStyle(region.querySelector("td:first-child") as Element);
    const sentence = globalThis.getComputedStyle(region.querySelector("td:last-child") as Element);
    expect(instant.paddingRight).toBe("0px");
    expect(sentence.paddingLeft).not.toBe("0px");
  });
});

/**
 * The interleaf is a grid AREA, not a floating panel.
 *
 * Which is the whole reason the page behind it stays in the document and in the tab order: the
 * leaf narrows, the sheet takes a column beside it, and nothing is absolutely positioned over
 * anything. A refactor that turned this into an overlay would render almost identically and
 * lose the property the design rests on, so it is asserted off the real sheet.
 */
describe("the interleaf", () => {
  it("takes a column beside the leaf rather than floating over it", () => {
    const book = render(`<div class="book book--interleaved"></div>`);
    const style = globalThis.getComputedStyle(book);
    expect(style.gridTemplateAreas).toContain("leaf interleaf");
    // Two columns: the leaf gives way, the sheet is fixed. A conversation read at a changing
    // width rewraps every time somebody opens a division.
    expect(style.gridTemplateColumns).toBe("minmax(0, 1fr) 24rem");
  });

  it("is a closed book's single column until it is opened", () => {
    const book = render(`<div class="book"></div>`);
    expect(globalThis.getComputedStyle(book).gridTemplateAreas).not.toContain("interleaf");
  });

  it("carries a hairline and no shadow, because ply is declared once", () => {
    const sheet = render(`<aside class="interleaf"></aside>`);
    const style = globalThis.getComputedStyle(sheet);
    // DESIGN.md's Ply Rule: a surface with a border does not also carry a shadow. This sheet
    // is bound in rather than standing off the board.
    expect(style.borderLeftStyle).toBe("solid");
    expect(style.boxShadow).toBe("");
  });

  it("wears no division hue: it belongs to the reader, not to a section", () => {
    // The Wheel Rule. ADR 0019 records that the seven hues are spoken for and an eighth is a
    // decision rather than a hex, so the sheet is on leaf stock and names no board.
    //
    // Asserted as the RESOLVED value rather than as the token's name, which is the stronger
    // claim: `--leaf` could be reassigned, and a sheet painted the open division's hue would
    // still read as `var(--leaf)` in the source.
    const style = globalThis.getComputedStyle(render(`<aside class="interleaf"></aside>`));
    const leaf = globalThis
      .getComputedStyle(document.documentElement)
      .getPropertyValue("--leaf")
      .trim();
    expect(leaf).not.toBe("");
    expect(style.background).toBe(leaf);
  });
});

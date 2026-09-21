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

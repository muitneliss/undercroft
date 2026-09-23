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

import { afterAll, beforeAll, describe, expect, test as it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SHEET = join(import.meta.dirname, "index.css");

/** The width happy-dom opens its window at, and what a block that changes it puts back. */
const WINDOW = 1024;

/**
 * The reader's window, for the one promise below that a media query answers differently at
 * two widths. A layout rule read at one width is half a rule.
 */
function viewport(width: number): void {
  (
    globalThis as unknown as { happyDOM: { setViewport: (size: { width: number }) => void } }
  ).happyDOM.setViewport({ width });
}

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

  // The ledger is drawn inside the journal's hinge row, and the hinge's cell rules were written
  // with descendant selectors -- so they reached every cell of the ledger too. Hovering the
  // run's leaf zeroed the gutter above and set `17:15:16Bắt đầu.` as one word again; at rest
  // they took the line spacing and an error line's wash. Hover is not computable here, so the
  // same leak is asserted at rest: a hinged ledger draws its lines as a bare one does.
  it("draws its lines inside the journal's hinge row exactly as it does on its own", () => {
    const line = LINE.replace("<tr>", `<tr class="feed__line feed__line--error">`);
    function drawn(cell: Element): Record<string, string> {
      const style = globalThis.getComputedStyle(cell);
      return {
        paddingTop: style.paddingTop,
        paddingBottom: style.paddingBottom,
        paddingLeft: style.paddingLeft,
        background: style.background,
      };
    }
    const bare = drawn(render(line).querySelector("td:last-child") as Element);
    const hinged = render(
      `<table class="table"><tbody><tr class="table__hinge"><td>${line}</td></tr></tbody></table>`,
    );
    expect(drawn(hinged.querySelector(".feed__region td:last-child") as Element)).toEqual(bare);
  });
});

/**
 * A query's answer is not a schedule, and the sheet has to know which it is drawing.
 *
 * Both are `.table` inside `.result`, and the two facts that separate them are invisible to
 * every other check in the gate: a schedule's last column holds a figure and is set to the
 * right, and its columns are sized by the browser from their content. Applied to an answer,
 * the first put a ONE-column result -- name, type and every cell -- against the right edge
 * of the pane, which typechecks, lints and renders perfectly; the second is what leaves a
 * column of extracted document text at whatever width the first hundred rows happened to
 * want, with no grip on it.
 *
 * So `result--grid` is the distinction, and it is asserted from both sides: it must hold for
 * an answer, and a bare `.table` must keep the schedule's behaviour, or the fix has simply
 * been applied to every table in the book.
 */
describe("a query's answer", () => {
  const GRID = `<div class="result result--grid"><table class="table">
    <thead><tr><th scope="col">text</th></tr></thead>
    <tbody><tr><td class="datum"><span class="cell">VIETCHAM SINGAPORE COM</span></td></tr></tbody>
  </table></div>`;

  /** The same markup a journal or a tenant list draws: a schedule, no `result--grid`. */
  const SCHEDULE = `<table class="table">
    <thead><tr><th scope="col">Bytes</th></tr></thead>
    <tbody><tr><td class="datum">122</td></tr></tbody>
  </table>`;

  it("reads from the left even when its only column is also its last", () => {
    const grid = render(GRID);
    const head = globalThis.getComputedStyle(grid.querySelector("th:last-child") as Element);
    const cell = globalThis.getComputedStyle(grid.querySelector("td:last-child") as Element);
    expect(head.textAlign).toBe("left");
    expect(cell.textAlign).toBe("left");
  });

  it("leaves a schedule's last column set to the right, where a figure belongs", () => {
    const schedule = render(SCHEDULE);
    const cell = globalThis.getComputedStyle(schedule.querySelector("td:last-child") as Element);
    expect(cell.textAlign).toBe("right");
  });

  it("leaves a figure right-aligned, because a figure says so for itself", () => {
    // The `:not(.num)` half. `ChartFrame`'s pivot is a schedule drawn into a bare `.result`,
    // and a grid that ever carries a total must not straighten it out.
    const grid = render(GRID.replaceAll(`class="datum"`, `class="datum num"`));
    expect(
      globalThis.getComputedStyle(grid.querySelector("td:last-child") as Element).textAlign,
    ).toBe("right");
  });

  it("divides its pane into columns, each with a width and a travel the reader can drag", () => {
    const grid = render(GRID);
    const table = globalThis.getComputedStyle(grid.querySelector(".table") as Element);
    const head = globalThis.getComputedStyle(grid.querySelector("th") as Element);
    // Fixed layout is what puts the width on the header cell -- which is the cell the grip
    // is in. Without the declared width a drag takes the neighbouring columns to nothing.
    expect(table.tableLayout).toBe("fixed");
    expect(head.width).not.toBe("");
    // The cell is what the grip is positioned against.
    expect(head.position).toBe("relative");
    // And these two are the whole reason this assertion exists. Fixed layout IGNORES them on
    // a cell -- which is why the floor is a `width` -- so a reader who knows that arrives
    // here certain they are dead and deletes them. They are the only place a column's travel
    // is written, and `SizeGrip` reads them off the computed style.
    expect(head.minWidth).not.toBe("");
    expect(head.maxWidth).not.toBe("");
  });

  it("leaves a schedule's columns to the browser, which sizes them from their content", () => {
    const table = globalThis.getComputedStyle(render(SCHEDULE));
    expect(table.tableLayout).not.toBe("fixed");
  });
});

/**
 * The reference rail's edge is the workbench's left-right handle.
 *
 * The editor's own grip moves the boundary between writing and reading; this one moves what
 * the editor and the answer share. What is worth pinning is the fold, which is a drag's
 * natural enemy: a drag writes an INLINE width that no class outranks -- `resize` did, and
 * `SizeGrip` still does (ADR 0042) -- so the folded rule has to CLAMP rather than set, or a
 * rail dragged wide stays wide when it is folded and the spine's label sits in a third of the
 * page.
 */
describe("the reference rail", () => {
  const RAIL = `<aside class="rail-ref"><hr class="grip grip--inline" /></aside>`;

  // happy-dom opens a 1024px window, which is exactly the workbench's narrow breakpoint --
  // where there is no column beside the rail to trade width with and the drag is off by
  // design. So a desk is asked for explicitly, and given back.
  beforeAll(() => {
    viewport(1440);
  });
  afterAll(() => {
    viewport(WINDOW);
  });

  it("hands its whole edge to the reader", () => {
    const rail = render(RAIL);
    const grip = globalThis.getComputedStyle(rail.querySelector(".grip") as Element);
    // The rail is what the grip is positioned against; the grip is the full height of it.
    expect(globalThis.getComputedStyle(rail).position).toBe("relative");
    expect(grip.display).not.toBe("none");
    expect(grip.cursor).toBe("col-resize");
  });

  it("folds to its spine however wide it was dragged", () => {
    const style = globalThis.getComputedStyle(
      render(`<aside class="rail-ref rail-ref--folded"></aside>`),
    );
    expect(style.maxWidth).toBe(style.width);
  });

  it("stops being a rail where there is no column beside it", () => {
    viewport(720);
    const rail = render(RAIL);
    const style = globalThis.getComputedStyle(rail);
    const grip = globalThis.getComputedStyle(rail.querySelector(".grip") as Element);
    // Read before the window goes back: the declaration is live, so a value read after it
    // is the desk's answer again.
    const narrow = { display: grip.display, maxWidth: style.maxWidth };
    viewport(1440);
    // Under the work rather than beside it: nothing to trade width with, so there is no edge
    // to hand over -- and `display: none` also keeps a dead grip out of the tab order. The
    // inline width a drag at a desk left behind is clamped rather than obeyed.
    expect(narrow.display).toBe("none");
    expect(narrow.maxWidth).toBe("100%");
  });
});

/**
 * The grip itself: the two facts about it that nothing else in the gate can see.
 *
 * Neither is visible to a reviewer either. `touch-action` is one declaration whose absence
 * turns every touch drag into a page scroll -- no `pointermove` ever arrives, and the
 * component looks perfectly correct. And where an editor sits inside a pane that carries its
 * own edge, TWO grips land on one boundary; which of them is live is decided here, in the
 * sheet, because the editor should not have to know which window it was put in. ADR 0042.
 *
 * The drag is not asserted, here or anywhere: there is no layout engine offline and happy-dom
 * has no pointer capture, so `@/lib/dragSize` holds everything about the drag that a machine
 * can check and this holds the declarations it needs to be reachable at all.
 */
describe("a pane's grip", () => {
  it("takes the gesture rather than leaving it to scroll the page", () => {
    const grip = globalThis.getComputedStyle(render(`<hr class="grip grip--block" />`));
    expect(grip.touchAction).toBe("none");
    expect(grip.cursor).toBe("row-resize");
  });

  it("belongs to the pane, not to the editor inside it", () => {
    render(`<div class="workbench__editor">
      <div class="editor"><hr class="grip grip--block" /></div>
      <hr class="grip grip--block" />
    </div>`);
    const inner = document.querySelector(".editor > .grip") as Element;
    const pane = document.querySelector(".workbench__editor > .grip") as Element;
    expect(globalThis.getComputedStyle(inner).display).toBe("none");
    expect(globalThis.getComputedStyle(pane).display).not.toBe("none");
  });

  it("is alone on the boundary when the editor is a band on a leaf", () => {
    const editor = render(`<div class="editor"><hr class="grip grip--block" /></div>`);
    const grip = globalThis.getComputedStyle(editor.querySelector(".grip") as Element);
    expect(grip.display).not.toBe("none");
    // The travel the grip reads off this box, and the only place it is written.
    const style = globalThis.getComputedStyle(editor);
    expect(style.minHeight).not.toBe("");
    expect(style.maxHeight).not.toBe("");
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

# 37. A query's grid divides its pane, and its columns are the reader's to drag

- Status: Accepted
- Date: 2026-09-22

## Decision

A query result — `ResultTable`, the grid the lake console, a model's build preview and a
question's table answer are all drawn with — declares itself `result--grid` and is a
different object from a schedule, in three ways written into `apps/ui/src/index.css`:

- **It reads from the left.** `.table td:last-child` sets a schedule's final column to the
  right, where a figure or a verb belongs. A grid's last column is whatever the author's
  SELECT ended with, so the rule is answered for `result--grid` — except on `.num`, which
  is `ChartFrame`'s pivot saying for itself that its last column is a total.
- **It divides its pane rather than being sized by its contents.** `table-layout: fixed`,
  with a declared `width: 6rem` on every header cell. Above that floor the pane's spare
  width divides equally: four columns are four quarters, eleven are eleven elevenths.
- **Every column has a grip.** `resize: horizontal` on the header cell. Dragging one column
  out makes the grid scroll sideways — which it already does, and already says so with the
  sheet's own bar — while its neighbours hold their 6rem; dragging it back divides the
  spare width equally again. A cell's line is clipped by its column (`.cell` is
  `max-width: 100%`, not a fixed 24rem), so what the grip reveals is text.

The schema rail on the same workbench takes a `resize: horizontal` too, which is the other
boundary a reader moves: the editor's own grip is the line between writing and reading, and
the rail's edge is the line between the reference and both of them. The folded rail clamps
with `max-width` rather than setting `width`, because a drag writes an inline width that no
class outranks.

`apps/ui/src/layout.test.ts` pins each of these off the real stylesheet, from both sides: a
grid's last column computes `left` and a schedule's still computes `right`; a grid computes
`table-layout: fixed` and a schedule does not; the rail computes `resize: horizontal` at a
desk and `none` below the workbench's narrow breakpoint.

## Why

- **A one-column answer was set against the right edge of the page.** The schedule's
  `:last-child` rule is written for the last of several columns; when a result has one
  column, that column is also its last, so the name, the type under it and every cell swung
  right — with the disclosure markers left stranded mid-pane. It renders, it typechecks, it
  passes every test, and it reads as a grid that has fallen off the page. This is the same
  class of defect as ADR 0027's: a composition that is wrong in a way nothing raises.
- **A column sized by its contents cannot be read by the person who needs it.** The lake's
  reason for existing is `raw.document_text`, where one cell is six thousand characters.
  The browser gave that column whatever the first hundred rows happened to want, `.cell`
  capped the line at 24rem regardless of how much pane there was, and nothing in the
  interface let the reader trade one column's width for another's. A grid's widths are a
  reading decision, and the reader is the one making it.
- **Fixed layout is what makes the grip possible at all**, not a preference. The width has
  to sit on the header cell for `resize` to have something to change, and content-sized
  columns overwrite it on every query. Measured in Chromium against the real markup: with
  no declared width on the header (or a percentage one) a drag crushes the neighbouring
  columns to 29px and the grid never scrolls; with `width: max-content` on the table,
  content drives the columns again and one long text cell takes 600px on its own.
  `min-width` cannot serve as the floor — fixed layout ignores it on a cell — which is why
  the floor is a `width`.
- **`resize` rather than a handle of our own**, for the reason the editor's pane already
  gives: it is the browser's own affordance, it owns no state and persists nothing, and a
  reader who has used any other resizable pane knows where the grip is. A column width is
  not a fact the platform needs to remember; `.claude/rules/state.md` would house it in the
  Zustand store, and it would be the first thing in there that nothing but a mouse ever
  reads.

## Rejected

- **Right-aligning nothing, by deleting `.table td:last-child`'s rule.** Rejected: it is
  correct on a schedule, which is most tables in the book — a byte count or a verb at the
  right end of a row is the reason it exists. The answer is which kind of table this is,
  and that is what `result--grid` says.
- **Scoping the fix to `.result` instead of a new class.** Rejected: `ChartFrame`'s pivot is
  drawn into a bare `.result` and is a schedule — its last column is a total, and its
  columns are figures that want to be as wide as the figure. Everything here is wrong
  there.
- **Columns of a fixed measure (28ch each) rather than an equal division.** Rejected with
  the user: four columns of a lake query would then scroll sideways on arrival, on a grid
  whose resting state should be the pane it was given.
- **Widths dragged with our own handle and kept in the store**, per column name, per tenant.
  Rejected: it is a pointer-event reducer, a persistence question and a reset policy, for
  something the browser does in one declaration — and the state it introduces has one
  writer and no reader but the grid itself.
- **Making the editor pane itself horizontally resizable (`resize: both`).** Rejected with
  the user: the editor cannot be wider than the column it sits in, so a horizontal grip
  there can only make it narrower than the answer beneath it — a ragged edge in exchange
  for a second grip in the same corner. The rail's edge moves the editor and the answer
  together, which is what "wider" actually meant.
- **Raising `.cell`'s cap from 24rem to something larger.** Rejected: it is the same fixed
  guess one notch further out, and it still answers a question — how much of this value
  fits — that only the column can answer.
- **Asserting the drag itself.** There is no layout engine in the offline gate and happy-dom
  computes style but not boxes, so what is pinned is the declaration the drag needs
  (`table-layout`, a declared header width, `resize`). The behaviour above — four quarters,
  neighbours holding, the grid scrolling — was measured in a real browser and is recorded
  here rather than implied by a test that cannot see it.

# 40. A pane's whole edge is its handle

- Status: Accepted
- Date: 2026-09-23
- Supersedes: the "`resize` rather than a handle of our own" bullet of
  [ADR 0037](0037-a-query-grid-divides-its-pane.md) and its rejected option "widths dragged
  with our own handle and kept in the store". ADR 0037's other three decisions -- a grid reads
  from the left, it divides its pane, `table-layout: fixed` with a declared header width --
  stand unchanged.

## Context

Four surfaces in the SPA are the reader's to resize, and all four said so with the browser's
`resize` property: the console's reference rail (`.rail-ref`), the editor pane above its
answers (`.workbench__editor`), the model editor (`.editor`), and every column of a query's
grid (`.result--grid .table th`).

`resize` draws one grip, in the bottom-right corner, roughly 16px square. Every boundary it
was asked to move is a LINE: the rail's edge is the height of the workbench, the editor pane's
is the width of the work column, a column's is the height of the grid. A hand that reaches for
that line closes on nothing anywhere along it except one speck at one end -- four times on one
screen. And the corner answers no key at all, at any size, for anyone: four resizable surfaces
were mouse-only, which is a WCAG 2.1.1 failure we shipped four times.

## Decision

A component of our own, `apps/ui/src/components/SizeGrip.tsx`, on all four:

- **It sizes the element it is written into.** `parentElement`, and no other interface -- no
  ref threading, no id, no context -- so a call site is one line and a new resizable box is a
  `position: relative` plus a grip.
- **The sheet still says how far.** The floor and the ceiling are read off `getComputedStyle`
  at `pointerdown`, never passed as props, so `apps/ui/src/index.css` stays the single place a
  pane's travel is written.
- **It writes the same inline measure `resize` wrote** -- `style.width` / `style.height` in
  px. That is why the folded rail's `max-width` clamp and the narrow-viewport rail's needed no
  new code: they were already written to outrank an inline width, and they still do.
- **Keyboard**: the arrows of its own axis move the edge by 16px, `Home` and `End` go to the
  sheet's two ends, `Escape` cancels a drag in flight. The arrows of the other axis are
  deliberately not answered, so they still scroll whatever is under the grip.
- **Double-click clears the inline measure**, which returns the pane to the sheet's own figure
  and the grid's spare width to an equal division -- a reset the browser's corner never had.
- **`<hr>`, not `<div role="separator">`.** `hr`'s implicit role IS separator, and Biome's
  `useSemanticElements` refuses the div outright. Measured against this repo's Biome 2.5.14:
  the `<hr>` form passes every a11y rule in `preset: "all"` with no suppression, because
  Biome's ARIA table classes `separator` as a widget (so `noNoninteractiveTabindex` and
  `noStaticElementInteractions` both return early) and its event tables do not model pointer
  events at all.
- **Nothing is persisted and nothing enters the store.** Two refs, a DOM handle and a latch,
  and no re-render between `pointerdown` and `pointerup`.

The arithmetic -- clamping, the measure a drag or a key is asking for, reading a computed
length, the share of its travel an edge sits at -- is in `apps/ui/src/lib/dragSize.ts`, which
holds no DOM and is where the tests are.

## Why

- **ADR 0037's objection was to state, and there is none.** It rejected a handle of our own as
  "a pointer-event reducer, a persistence question and a reset policy", introducing state
  "with one writer and no reader but the grid itself". There is no store entry, nothing is
  persisted, the reset is `removeProperty`, and the drag writes the same inline style the
  browser wrote. What is left of the objection is the component itself, which is 200 lines
  and shared by four surfaces.
- **The property that argument was really defending is kept.** "The sheet owns the limits" is
  what made `resize` cheap, and reading them back out of `getComputedStyle` is what keeps it
  true: a drag cannot exceed a bound this repo did not write down, and the two rails that
  clamp a dragged width still do it in CSS.
- **A keyboard where there was none.** This is the part `resize` could not have been fixed
  into having.
- **`position: relative` and a declared travel are now load-bearing in places they look dead.**
  Most of all on `.result--grid .table th`, where fixed layout IGNORES `min-width` and
  `max-width` -- ADR 0037 measured that, and it is why the floor is a `width` -- but
  `getComputedStyle` reports them and the grip reads them. `layout.test.ts` asserts them for
  that reason alone.

## What it costs

Written here rather than discovered later: a ref per grip; a keyboard story that is ours to
keep; pointer capture (without which a fast drag off an 8px strip stops following the hand);
`touch-action: none` (without which a touch drag is a page scroll and no `pointermove` ever
arrives); a grip overlaying the bottom 8px of the standalone editor, where CodeMirror draws
its horizontal scrollbar -- if a reader reports it, the answer is to reserve the strip rather
than overlay it, not to pre-build that today; and an LTR assumption in `inline`, since both
catalogues are LTR and a direction we cannot test is not one to build.

## What was measured

In Chromium against the real stylesheet, because the offline gate cannot see any of it. The
rail's grip is 8px wide and the full 418px height of the rail; the pane's is the full 738px
width of the work column; a column's is the full height of its header cell.

- A drag of the rail's edge from the middle of it moved 272px to 372px exactly, and wrote
  `width: 372px` inline. Dragged fast past the floor and off the element entirely -- down to
  (40, 600), well outside the 8px strip -- it stopped at 176px (11rem) and kept following the
  pointer, which is pointer capture doing its job.
- The editor pane stopped at 302px, which is the 72% its sheet declares of the work column:
  the percentage ceiling resolves.
- Keyboard: tab focus lands on the grip and announces its label, each arrow moves 16px,
  `Home` goes to 176px and `End` to 544px (34rem). `Escape` mid-drag returned the rail to the
  measure the drag started from, and the pointer moving on afterwards changed nothing.
- Double-click cleared the inline measure and returned the pane to the sheet's own figure.
- A column dragged far took the width the grip wrote (clamped at its 60rem ceiling), its
  neighbours held their 6rem, and the grid scrolled sideways by 412px -- ADR 0037's promise,
  unchanged. Between the resting state and there, a fixed-layout table whose total width is a
  percentage redistributes its surplus in PROPORTION to the specified widths, so a 129px drag
  widened the column by 243px and shrank its neighbours toward the floor rather than holding
  them at it. That is the browser's arithmetic, not ours -- `resize` wrote the same inline
  width and produced the same redistribution -- and each move is computed from the drag's
  ORIGIN rather than incrementally, so the edge returns exactly where it started.
- **The grip's hairline is transparent at rest, and that was decided by looking.** Drawn, it
  put a second rule 4px inside the frame the rail and both editors already have -- two rules
  where the sheet has one. The edge inks under the hand instead, which is also when a grid's
  column boundary gains a divider it never had.

## Rejected

- **Keeping `resize` and adding the edge strip.** Rejected: two grips on one boundary in the
  same corner is one grip a reader can never hit -- the exact defect
  `.workbench__editor > .editor` was already written to answer.
- **`window` listeners for the drag.** Rejected: pointer capture retargets every later move
  and the release to the grip itself, so React's own props see them, there is nothing to
  subscribe to and nothing to clean up on unmount.
- **The measures in the Zustand store, per pane or per column name.** Rejected, still, for
  ADR 0037's reason: a pane's measure has one writer and no reader but the pane.
- **`matchMedia` in React for the narrow viewport**, where the rail sits under the work and
  has nothing to trade width with. Rejected: a subscription plus somewhere to keep the answer
  is `useState` by another name. The sheet hides that grip, which also takes it out of the tab
  order. The FOLD is the opposite case and is answered the opposite way -- it is store state
  the component already reads, so the grip is simply not rendered.
- **A `resizable` prop on `SqlEditor`.** Rejected: the editor would have to know which window
  it was put in. The sheet has arbitrated that since the pane was written.
- **Asserting the drag itself.** Restating ADR 0037's limit rather than implying more: there
  is no layout engine in the offline gate, happy-dom computes style but not boxes and has no
  pointer capture at all. So the arithmetic is pinned in `dragSize.test.ts`, the declarations
  the drag needs are pinned in `layout.test.ts`, and the behaviour itself -- 8px is hittable,
  capture holds through a fast drag, a dragged column leaves its neighbours at 6rem and the
  grid scrolls, a rail dragged to 30rem still folds to its spine -- is measured in a real
  browser and recorded here.

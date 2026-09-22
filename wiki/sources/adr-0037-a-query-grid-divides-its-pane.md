---
title: ADR 0037 A Query Grid Divides Its Pane
type: source
date: 2026-09-22
tags: []
source: docs/adr/0037-a-query-grid-divides-its-pane.md
source_path: docs/adr/0037-a-query-grid-divides-its-pane.md
source_hash: 38a0c02bdfdd505c7e92f40859cde858e3c8e063cd2efcc03202a1adc1ee5e4c
ingested: 2026-09-22
---

# ADR 0037 A Query Grid Divides Its Pane

A query result -- the grid `ResultTable` draws for the lake console, a model's build preview and a question's table answer -- declares itself `result--grid` and is a different object from a schedule in three ways, written into `apps/ui/src/index.css`. It reads from the left: `.table td:last-child` sets a schedule's final column to the right, where a figure or a verb belongs, and that is answered for a grid except on `.num`, which is `ChartFrame`'s pivot saying for itself that its last column is a total. It divides its pane rather than being sized by its contents: `table-layout: fixed` with a declared `width: 6rem` on every header cell, above which the pane's spare width divides equally. And every column carries a grip -- `resize: horizontal` on the header cell -- so dragging one column out makes the grid scroll sideways while its neighbours hold their 6rem, and a cell's line is clipped by its column (`.cell` is `max-width: 100%`, not a fixed 24rem) so what the grip reveals is text.

The defect that prompted it is the same class as [[ADR 0027 A Control Sits on Its Field's Line]]: a composition wrong in a way nothing raises. A one-column answer's only column is also its last, so the schedule's `:last-child` rule put the name, the type under it and every cell against the right edge of the pane -- rendering, typechecking and passing every test while doing it. The second half is about reading rather than alignment: the lake's reason for existing is `raw.document_text`, where one cell is six thousand characters, and the browser gave that column whatever the first hundred rows happened to want while `.cell` capped the line at 24rem regardless of how much pane there was.

Fixed layout is what makes the grip possible at all, not a preference: the width has to sit on the header cell for `resize` to have something to change, and content-sized columns overwrite it on every query. Measured in Chromium against the real markup -- with no declared width on the header, or a percentage one, a drag crushes the neighbouring columns to 29px and the grid never scrolls; with `width: max-content` on the table, content drives the columns again and one long text cell takes 600px on its own. `min-width` cannot serve as the floor because fixed layout ignores it on a cell.

The schema rail on the same workbench takes a `resize: horizontal` too: the editor's own grip is the line between writing and reading, and the rail's edge is the line between the reference and both of them. The folded rail clamps with `max-width` rather than setting `width`, because a drag writes an inline width that no class outranks. `resize` rather than a handle of our own follows the reasoning the editor's pane already carries -- it is the browser's affordance, owns no state and persists nothing, and a column width is not a fact the platform needs to remember, which is why widths kept per column in the Zustand store were rejected.

`apps/ui/src/layout.test.ts` pins each declaration off the real stylesheet from both sides: a grid's last column computes `left` and a schedule's still computes `right`, a grid computes `table-layout: fixed` and a schedule does not, and the rail computes `resize: horizontal` at a desk and `none` below the workbench's narrow breakpoint. The drag itself is not asserted -- there is no layout engine in the offline gate and happy-dom computes style but not boxes -- so the measured behaviour is recorded in the ADR rather than implied by a test that cannot see it.

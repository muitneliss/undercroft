# 100. The lineage board's selected chains flow

- Status: Accepted
- Date: 2026-10-01
- Extends: [ADR 0097](0097-lineage-is-drawn-on-a-board-the-reader-arranges.md), whose selection
  inks the upstream chain and dots the downstream chain
- Departs from: [ADR 0014](0014-frames-are-size-motion-is-stepped.md)'s stepped motion, for one
  continuous animation, as the run map's live edge already does

## Context

On a project of sixty models, selecting a card inks a handful of wires among hundreds. A still
2px line is easy to lose where it crosses dimmed ones, and the direction of a dependency is
carried only by a 14px arrowhead at its far end. Readers asked for the selected dependencies to
be highlighted with a line that runs into the node.

## Decision

Every wire on the selection's chains carries **beads of ink that travel from source to target**:
along the upstream chain they run into the selected card, along the downstream chain they run out
of it. The beads are a second SVG path over the wire (`lineage-wire__flow`), wider than the wire,
so the wire keeps its own stroke between them -- solid upstream, dotted downstream, dashed when
it comes from a missing dependency -- and the legend reads exactly as before.

The animation is `linear` and continuous, the second such in `index.css` after the run map's
live edge, for the reason recorded there: a travelling mark stepped at a legible frame count
reads as a rendering fault, not as movement. Everything else still steps.

Under `prefers-reduced-motion: reduce` the beads are not drawn. The stroke and the words on every
card ("upstream", "downstream") already carry which chain is which; a stilled bead is only noise.

## Consequences

- Motion on the board means direction, where on the run map it means "still running". The two
  never share a screen, and the lineage's beads ride on a wire whose own stroke the legend names.
- The beads are ink, not the Models division's violet: DESIGN.md keeps wheel hues off the page.
- A dimmed or unselected wire never moves, so a board with nothing selected is still.

## Options rejected

- **`@xyflow/react`'s `animated` edge.** It turns the wire itself into a crawling dash, which
  would make the solid upstream chain look like the dashed edge from a missing dependency.
- **Colour.** A violet or chrome chain would be a wheel hue used as an accent inside a page.
- **Stepped beads (`steps(n)`).** Tried on the run map first; a bead jumping in visible frames
  looks broken rather than moving.

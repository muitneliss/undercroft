---
title: ADR 0100 The Lineage Board's Selected Chains Flow
type: source
date: 2026-10-01
tags: []
source: docs/adr/0100-the-lineage-selection-flows.md
source_path: docs/adr/0100-the-lineage-selection-flows.md
source_hash: c9b2b5ed00ecc0fac23a2f8377b1e71bb78e5e7625497a6233ab45b2e4ad24d3
ingested: 2026-10-01
---

# ADR 0100 The Lineage Board's Selected Chains Flow

Every wire on the lineage board's selected chains carries round beads of ink that travel from source to target, extending [[ADR 0097 Lineage Is Drawn on a Board the Reader Arranges]]: along the upstream chain they run into the selected card, along the downstream chain out of it. Readers asked for the selected dependencies to be highlighted with a line running into the node; on a sixty-model project a still 2px line was easy to lose among dimmed ones, and direction was carried only by an arrowhead.

Decision. The beads are a second SVG path over the wire (`lineage-wire__flow` in `LineageCards.tsx` and `index.css`), wider than the wire, so the wire keeps its own stroke between them -- solid upstream, dotted downstream, dashed from a missing dependency -- and the legend reads unchanged. The animation is `linear` and continuous, the second such in `index.css` after the run map's live edge, departing from [[ADR 0014 Frames Are Size, Nothing Eases]] for the reason recorded there: a travelling mark stepped at a legible frame count reads as a rendering fault. Under `prefers-reduced-motion: reduce` the beads are not drawn; the stroke and each card's words ("upstream", "downstream") carry which chain is which.

Consequences: motion on the lineage board means direction, where on the run map it means "still running"; the beads are ink, not the Models division's violet, because DESIGN.md keeps wheel hues off the page; a dimmed or unselected wire never moves. Rejected: `@xyflow/react`'s `animated` edge (it turns the solid upstream wire into a crawling dash that looks like a missing dependency's edge), colour (a wheel hue as an accent), and stepped beads.

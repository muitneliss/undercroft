---
title: >-
  ADR 0116 The Journal Can Be Read as a Village, Drawn in WebGL and Moved in
  Stop-Motion
type: source
date: 2026-10-07
tags: []
source: docs/adr/0116-the-journal-can-be-read-as-a-village.md
source_path: docs/adr/0116-the-journal-can-be-read-as-a-village.md
source_hash: 520457e91fa0a56f625b3c2eb78389da01e694c3e17a95080fac50bd5c07659e
ingested: 2026-10-07
---

# ADR 0116 The Journal Can Be Read as a Village, Drawn in WebGL and Moved in Stop-Motion

Adds a village view to the Journal at `/tenants/:id/journal?view=village`, beside the ledger, and makes every node-and-edge drawing in the interface a village. Supersedes, for the village only, two rejections in [[ADR 0063 The Public Cover Moves Continuously]] ("a motion library or WebGL" and "extending the exception to the app"). Supersedes [[ADR 0097 Lineage Is Drawn on a Board the Reader Arranges]]'s pannable, zoomable, draggable board, and ADR 0100's linear beads on the selected chains. ADR 0097's columns, selection, chains and text list stand, and so does [[ADR 0103 The Lineage Board Is Laid Out by ELK]]. ADR 0014's stepped rule is applied in three dimensions.

Decision (the town).

* One customer, live, through the reader's session.
* Nothing moves without a run: a pure derivation from run status, events and steps, tested outside WebGL.
* Stop-motion at 10 fps.
* `three` in a lazy chunk with an imperative runtime outside React state.
* A model village on a desk in the design system's inks:
  * colours along the tonal ramps by hue family and lightness, with paper grain;
  * a warm key light, a fill and a room reflection;
  * soft shadows on the board and the page, and ambient occlusion;
  * Ink outlines, a tilt-shift focus band, and page grain with a vignette.
* "Rules, never shadows" governs the book's sheets, not an object on the desk.
* Weather and machinery move on their own and claim nothing.
* Canonical division hues only on roofs; vermilion only on slips.
* KayKit CC0 assets with provenance; a fixed orthographic camera.
* A wordless, `aria-hidden` canvas, with words beside it.

Every node-and-edge drawing is a village. The run map (`RunFlow`) and the lineage (`LineageCanvas`) are villages built by the same film; `@xyflow/react` is gone.

* Exactly the graph: one building per node, one road per edge, and traffic exactly where the board animated an edge. `village.test.ts` holds this.
* Buildings by kind, with division-hue roofs: model houses, raw-table storehouses, missing-dependency ruins, and run stages as a stall, the hall, the workshop or the vault. Slips mark a stopped stage or a failed build.
* Roads: plain; inked upstream; dashed downstream; faint when dimmed; broken from a missing dependency; with arrowheads.
* Traffic: a courier on a run's road, carts on the lineage's.
* ELK still places the nodes and routes the roads.
* The fixed camera fits the whole graph (the owner's decision), giving up pan, zoom, drag, the minimap and reset. Full screen stays.
* Node names in the words carry `data-node`, so pointing lights them. A building press selects; a ground press clears.

Boundary: opt-in for the town; loops only while visible; reduced motion paints one settled frame; failure shows a sentence; counts are never told by crates.

Rejected: `@react-three/fiber`, smooth 60 fps, an eighth division, a cross-customer village, characters built from primitives, a push channel.

Consequences: `three` is loaded by the town, a run or the lineage; `@xyflow/react` is removed; the asset tools are exact-pinned; `.glb` joins the allow-list; deterministic passes keep canvas baselines; `docs/design/village.md` owns the cast and the drawings; DESIGN.md describes them.

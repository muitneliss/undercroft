---
title: ADR 0097 Lineage Is Drawn on a Board the Reader Arranges
type: source
date: 2026-09-30
tags: []
source: docs/adr/0097-lineage-is-drawn-on-a-board-the-reader-arranges.md
source_path: docs/adr/0097-lineage-is-drawn-on-a-board-the-reader-arranges.md
source_hash: 79aa172fc368981bcbf7bf35cd04ad6f3887bf56687e9b8441c0e9f1949bde0c
ingested: 2026-09-30
---

# ADR 0097 Lineage Is Drawn on a Board the Reader Arranges

# ADR 0097 Lineage is drawn on a board the reader arranges

Status: Accepted, 2026-09-30. Supersedes, from [[ADR 0092 Lineage Draws Only Declared Relations]], only the fixed-grid drawing ("no graph library"), its rejected option "a graph library", and the limit of a selection to a model and to its upstream side. Everything else in ADR 0092 stands: an edge is a declaration and nothing else, no source-account or report nodes, "upstream not declared" rather than no parents, a missing dependency kept with its edge, the `?view=lineage&model=` address, and a text path beside the drawing. Refs the UI review prototype `review/ui-r5b` (#346), whose "Upstream paths" and column headings it adopts.

## Context

The grid shared the leaf's width between its columns. A real project, sixty models with twenty in one column, cut every name to seven characters, cards could not be moved apart, and edges crossed into one thicket; a model's last build and columns were not reachable from the view.

## Decision

* **A board on `@xyflow/react`**, the library the run map already ships, so no new dependency. Cards are as wide as a name needs; the reader pans, zooms and drags a card, and "reset layout" restores the computed one. A column is still the longest declared chain below a node, headed in words ("Level 2"); within a column a barycentre sweep in both directions only reduces crossings. A fitted view never shrinks below a readable zoom; a large project is panned, with a mini map.
* **A dragged place belongs to the board alone** (`defaultNodes`): working state like a scroll offset, kept nowhere, neither server state nor the Zustand store's. The selection stays the address; cards read it through a context.
* **The keyboard model is the page's**: each card is a real button, the library's node focus is off, and the picker and text below reach every node — the answer to ADR 0092's objection.
* **Any node can be selected**, a raw lake table and a missing dependency included, by the same `model` parameter. Its upstream chain is inked and its downstream chain drawn dotted and worded "downstream"; `scope=related` narrows the board to both chains. Nothing is added: both are declared edges followed.
* **Details beside the board**: last build and its run, the build's columns, SQL, what it reads and what reads it (each a press from being selected), and why its upstream cannot be read — all from `models.lineage`, `models.list` and `models.get`; no new procedure.
* **The text traces the selection**: every name upstream, every path from a node that reads nothing declared down to it, and every name downstream. Past fifty paths the list stops and says so rather than look complete.

## Consequences

* Below 760px the board steps aside; the details and trace are the view.
* A dragged layout is lost on reload, deliberately: a stored layout would be a second owner of where a node sits.
* Downstream is the one visual addition beyond ADR 0092, stroked and worded differently from upstream.

## Rejected

* Keeping the grid with horizontal scroll: stops truncation, keeps the thicket.
* Persisting dragged positions.
* A layout library (dagre, elk): ranks by distance to sinks, not by chain from the raw lake.
* The prototype's source-account and "suggested product" nodes: still guessed edges.

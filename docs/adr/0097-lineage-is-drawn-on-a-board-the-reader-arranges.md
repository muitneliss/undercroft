# 97. Lineage is drawn on a board the reader arranges

- Status: Accepted
- Date: 2026-09-30
- Supersedes: from [ADR 0092](0092-lineage-draws-only-declared-relations.md), the sentence "The
  drawing is plain HTML and SVG on a fixed grid: no graph library", its rejected option "A graph
  library", and "Selecting a model highlights its whole upstream chain and dims the rest" where
  it limits a selection to models and to the upstream side
- Keeps: everything else in ADR 0092 -- an edge is a declaration and nothing else, no source
  account or report nodes, "upstream not declared" rather than no parents, a missing dependency
  kept with its edge, the view's address, and a text path beside the drawing
- Refs: the UI review prototype `review/ui-r5b` (#346), its "Upstream paths" and column headings

## Context

ADR 0092 drew lineage as a CSS grid whose columns shared the leaf's width, and chose that over
`@xyflow/react` because a pan-and-zoom canvas needs its own keyboard model, while a layered grid
with a text list says the same and reads on a phone.

On a real project it did not say the same. Sixty models put twenty in one column; the grid gave
each column a sixth of the leaf, so every name was cut to seven characters, the cards could not
be moved apart, and the declared edges crossed into one thicket. A reader tracing a wrong figure
could not read the names on the chain they were tracing, and had no way to see a model's last
build or columns without leaving the view.

## Decision

- **The drawing is a board on `@xyflow/react`**, the library the run map already ships (no new
  dependency). Cards are as wide as a name needs and columns as far apart as the edges need;
  the reader pans, zooms, and drags a card, and "reset layout" puts every card back. A column is
  still the longest declared chain below a node, now headed in words ("Level 2"); the order
  within a column is a barycentre heuristic swept both ways, only to cross fewer edges.
- **A dragged place belongs to the board and nothing else.** The board is given its cards once,
  as `defaultNodes`; a dragged place is working state like a scroll offset, read by no other
  component and kept nowhere, so it is neither server state nor the store's. The selection is
  still the address alone; the cards read it through a context as they render.
- **The keyboard model is the page's, not the canvas's.** Each card is a real button, the
  library's own node focus is off, and the picker and the text below reach every node. That is
  the answer to ADR 0092's objection, and the reason the library is acceptable now.
- **Any node can be selected** -- a raw lake table and a missing dependency too -- by the same
  `model` parameter. Selecting one inks its upstream chain and, in a second stroke, its
  downstream chain: what a failure there reaches. Both are declared edges followed; nothing is
  added. `scope=related` narrows the board to those two chains.
- **The selected node's details stand beside the board**: its last build and the run that made
  it, the columns that build produced, its SQL, what it reads and what reads it -- each a press
  away from being the selection -- and why its upstream cannot be read. Every fact is one
  `models.lineage`, `models.list` or `models.get` already answers; no procedure is added.
- **The text beneath traces the selection**: every name on the upstream chain, every path from a
  node that reads nothing declared down to it, and every name downstream. Paths multiply at every
  join, so past fifty the list stops and says there are more rather than look complete.

## Consequences

- The board is a real dependency surface: its node measurement and fit are the library's.
  `@xyflow/react` is already pinned for the run map, so this adds no second graph library.
- Below 760px the board still steps aside; the details and the trace are the view on a phone.
- A dragged layout is lost on reload. That is deliberate: a stored layout is one more thing a
  saved model could leave stale, and the computed one is always there to go back to.
- Downstream is the one visual addition beyond ADR 0092, and it is drawn and worded differently
  from upstream (dotted, "downstream"), so it cannot be mistaken for the chain the reader asked
  about.

## Options rejected

- **Keeping the grid and widening it with horizontal scroll.** It would stop the truncation and
  keep the thicket: without a way to move a card or narrow the drawing, sixty models' edges
  still cross where the layout put them.
- **Persisting dragged positions** in the store or on the server. Nobody asked to keep a layout,
  and a kept one would be a second owner of where a node sits.
- **A second library for layout** (dagre, elk). Their ranking puts a node by its distance to the
  sinks, not by its chain from the raw lake, which is what a column here means; the sweep over
  the existing columns is a few lines and keeps that meaning.
- **The prototype's source-account and "suggested product" nodes.** Still guessed edges; ADR
  0092's reasons stand unchanged.

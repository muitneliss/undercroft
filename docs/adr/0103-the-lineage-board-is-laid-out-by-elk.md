# 103. The lineage board is laid out by ELK

- Status: Accepted
- Date: 2026-10-01
- Supersedes: from [ADR 0097](0097-lineage-is-drawn-on-a-board-the-reader-arranges.md), its
  rejected option "A second library for layout (dagre, elk)", and "the order within a column is
  a barycentre heuristic swept both ways" where it describes the board
- Keeps: everything else in ADR 0097 and [ADR 0092](0092-lineage-draws-only-declared-relations.md)
  -- a column is the longest declared chain below a node, a dragged place belongs to the board
  and nothing else, and the keyboard model is the page's

## Context

ADR 0097 placed each card at its column and its barycentre place within it, and drew each
declared edge as one curve from its source to its target. Measured on a real tenant's project
(77 nodes, 242 declared edges, twelve columns), 195 of the 242 curves ran over a card that was
neither of their ends: an edge spanning four columns crossed a card in each of the three between.
A reader tracing an inked chain could not tell which card a wire entered and which it only
passed, which is the one thing the board is for.

The barycentre sweep orders cards; it does not route edges, and no ordering stops a curve that
spans columns from crossing the cards in between. That needs a router that treats each column's
cards as obstacles, which is the work a layered layout engine does.

ADR 0097 rejected ELK because its ranking places a node by measures other than its chain from
the raw lake. ELK's layered algorithm can be told to keep the layers it is given instead.

## Decision

- **The board's places and wires come from the Eclipse Layout Kernel's layered algorithm**
  (`elkjs`, `apps/ui/src/lib/lineageArrange.ts`). A column is still `layout`'s: every card is
  handed to ELK already standing in its column, with `INTERACTIVE` layering and cycle breaking,
  so ELK keeps those layers and reverses only an edge that points back across them (a cycle dbt
  would refuse). The board is one layout, not one per disconnected part: ELK otherwise starts
  every part at its own first layer, and a model with no declared upstream drifted into the raw
  lake's column. ELK decides the order within a column, the vertical places, and the line each
  edge runs along.
- **Splines with network-simplex placement.** On the tenant's project, orthogonal routing drew
  seventy models' wires as a grid of parallel lines, and merging them into buses would ink a
  whole shared trunk for one selected chain. Brandes-Köpf placement drew the same project 72%
  taller. Splines with network simplex drew it with no wire over a card it does not join.
- **A wire keeps ELK's line only while both its cards stand where ELK put them.** Once a card is
  dragged, its wires are plain curves between the cards, as before; "reset layout" restores
  every place and every routed line.
- **ELK is loaded on demand**, as its own chunk: 1.4 MB minified, 438 kB gzipped, that only the board
  needs. Its answer is asynchronous, so the board holds its place with a skeleton until ELK
  answers. The board reads the answer by subscription, not Suspense: selecting a node is a router
  transition, and a transition that suspends holds the whole page -- picker, details and text --
  until ELK answers.
- **A layout ELK cannot produce is said, not guessed.** The board then says it could not be
  laid out, and the names and paths beneath it, which never depended on it, still say what each
  model reads.
- **The text list keeps `layout`'s order.** It is read without waiting for ELK, and a column's
  order there was only ever a heuristic.

## Consequences

- One more dependency, `elkjs` 0.12.0, under EPL-2.0 or GPL-3.0-or-later, used unmodified from
  npm.
- Laying out the tenant's whole project takes about 0.4 s on the main thread, once per drawing:
  the answer for a pair of graphs is kept, so re-selecting within the whole board costs nothing.
  Narrowing the board to a selection's chains lays out that smaller graph, which is fast.
- ELK can widen the gap between two columns to fit the wires that pass through it, so columns no
  longer stand at one fixed pitch. Each column's heading stands over its own cards.
- The visual baseline of the board at 1440 px changes with the layout.

## Options rejected

- **Keeping the barycentre sweep and routing edges ourselves.** Routing curves around obstacles
  through the gaps between columns is the substance of a layered layout engine; writing a second
  one here would be the larger and less tested change.
- **dagre.** It routes an edge through the dummy nodes of the columns it spans, but it offers
  no supported way to keep layers it is given, and so cannot keep a column's meaning.
- **ELK in a Web Worker.** It would take the 0.4 s off the main thread, but the bundled build
  runs unchanged in the browser, in the Bun suite and in the visual tier, and a worker needs a
  different entry point in each. The skeleton holds the board's place while it works; a worker
  stays open if a larger project makes the pause matter.
- **ELK's own layering** (`NETWORK_SIMPLEX`, `LONGEST_PATH`). Each ranks by a measure other than
  the longest declared chain from the raw lake, which is what a column here means.

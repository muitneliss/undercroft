# 138. The lineage board bounds its layout

- Status: Accepted
- Date: 2026-10-15
- Supersedes: from [ADR 0103](0103-the-lineage-board-is-laid-out-by-elk.md), "Splines with
  network-simplex placement" where it applies to a board larger than the budget below
- Keeps: everything else in ADR 0103 -- ELK's layered algorithm, the columns handed to it,
  splines, the bundled build loaded on demand, the board read by subscription, and a layout ELK
  cannot produce said rather than guessed

## Context

A tenant's project of 176 models and 618 declared edges, in thirteen columns, never left the
lineage board's skeleton, and the page froze with it. ADR 0103 placed every board's cards by
network simplex and recorded 0.4 s for a 77-model project; it runs in ELK's bundled build, which
works synchronously on the main thread, so nothing on the page answers until it returns.

What ELK's layered algorithm places is not the cards alone: an edge that spans columns leaves a
dummy node in each column it passes through, so the size that matters is the cards plus, for
each edge, the columns between its ends. Measured in Node with the board's own options on its
248 x 96 cards:

| Placed nodes (cards + dummies) | Network simplex | Brandes-Köpf |
| ------------------------------ | --------------- | ------------ |
| 176 to 180                     | 0.2 to 0.3 s    |              |
| 425 to 480                     | 0.7 to 0.8 s    |              |
| 769 to 784                     | 1.9 s           | 0.33 s (784) |
| 1268                           | 5.4 s           | 0.35 s       |
| 176 models, 618 long edges     | 20 s            | 0.48 s       |
| 6457 (600 models, 2500 edges)  |                 | 1.7 s        |

Network simplex grows about as the square of that size, Brandes-Köpf about linearly. ELK's
`thoroughness: 1` left the long-edge case at 14.7 s, and the edge routing (splines, orthogonal,
polyline) changed nothing: placement is the whole cost. On that project Brandes-Köpf drew the
board about 2.4 times taller (11,272 px against 4,735), and its straightening and alignment
variants did not change the height materially.

A test cannot catch the hang by its timeout: the layout blocks the thread the timer would fire
on, so the old code passed a suite holding this project after half a minute.

## Decision

- **Network simplex places a board of at most 500 placed nodes; Brandes-Köpf places a larger
  one** (`placementFor` in `apps/ui/src/lib/lineageArrange.ts`). The size is counted from the
  columns `arrange` already hands ELK, over the same edges it draws: each card, and for each
  edge that is not a self-reference the columns between its ends. 500 is about 0.8 s at worst
  among the measured graphs, twice ADR 0103's pause, and the most the board spends on its
  compact drawing.
- **The choice is the graph's, never a clock's.** The same graph draws the same way on every
  machine, in the suite and in the visual tier.
- **Every other option is unchanged**, so a board within the budget draws exactly as before.
- **The budget is pinned from both sides in the suite**, on a project of the tenant's shape
  (176 models, 610 edges spanning up to eleven columns) and on a small board, and that project
  is arranged whole: every card placed and every edge routed.

## Consequences

- A board past the budget draws taller, about 2.4 times on the measured project, and its chains
  run less level. The reader scrolls further; the wires still route between the cards they do
  not join.
- The main-thread pause stays bounded: under a second within the budget, and about half a
  second for the tenant's project past it, growing linearly from there.
- A board narrowed to one selection's chains is small, and keeps the compact drawing.
- The visual tier's board is 17 nodes and 16 edges, well within the budget, so its baselines do
  not change.

## Options rejected

- **Brandes-Köpf always.** It drew the 77-model project 72% taller (ADR 0103), and network
  simplex is affordable at that size; the budget keeps the compact drawing wherever it costs
  under a second.
- **ELK in a Web Worker, alone.** It would take the freeze off the main thread, but the board
  would still show its skeleton for twenty seconds, longer as projects grow; and ADR 0103's
  reason for the bundled build -- one entry point that runs unchanged in the browser, the Bun
  suite and the visual tier -- still holds. It stays open if a far larger project makes even
  Brandes-Köpf's pause matter.
- **A time budget that falls back.** The same graph would draw one way on a fast machine and
  another on a slow one, and the visual tier would flake between them. A size budget decides the
  same way everywhere.
- **Lowering ELK's thoroughness.** Measured: 14.7 s on the long-edge project, no answer to it.

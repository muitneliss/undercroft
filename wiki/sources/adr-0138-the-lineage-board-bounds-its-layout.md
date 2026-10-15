---
title: ADR 0138 The Lineage Board Bounds Its Layout
type: source
date: 2026-10-15
tags: []
source: docs/adr/0138-the-lineage-board-bounds-its-layout.md
source_path: docs/adr/0138-the-lineage-board-bounds-its-layout.md
source_hash: 9bbd8815cae515071cb2a302d0ee9b86ac7fd820457ced12b8e813b4f35922c1
ingested: 2026-10-15
---

# ADR 0138 The Lineage Board Bounds Its Layout

Accepted 2026-10-15. Supersedes, from [[ADR 0103 The Lineage Board Is Laid Out by ELK]], "splines with network-simplex placement" where it applies to a board larger than the budget; keeps everything else there (ELK's layered algorithm, the columns handed to it with `INTERACTIVE` layering, splines, the bundled build loaded on demand, the board read by subscription, an unproducible layout said rather than guessed).

**Context.** A tenant's project of 176 models and 618 declared edges in thirteen columns never left the lineage board's skeleton, and the page froze. ELK's bundled build runs synchronously on the main thread, and network-simplex placement grows about as the square of the placed nodes: each card plus a dummy node in every column an edge passes through. Measured with the board's options on 248 x 96 cards: about 0.3 s at 176 placed nodes, 0.8 s at 480, 1.9 s at 780, 5.4 s at 1268, and 20 s on the tenant-shaped long-edge project; Brandes-Köpf took 0.33 to 0.48 s on the same large graphs and 1.7 s at 6457 placed nodes, growing about linearly, but drew the large project about 2.4 times taller. `thoroughness: 1` left it at 14.7 s, and edge routing made no difference. A test's timeout cannot catch the hang, because the layout blocks the thread the timer would fire on.

**Decision.** `placementFor` in `apps/ui/src/lib/lineageArrange.ts` counts the drawn graph's placed nodes from the columns `arrange` already hands ELK, over the same non-self edges, and chooses network simplex at or below `NETWORK_SIMPLEX_BUDGET` (500, about 0.8 s at worst measured) and Brandes-Köpf beyond it. The choice is the graph's, never a clock's, so one graph draws one way on every machine and in the visual tier. Every other ELK option is unchanged. The suite pins the budget from both sides on a project of the tenant's shape (176 models, 610 edges spanning up to eleven columns) and a small board, and arranges the large project whole.

**Consequences.** A board past the budget draws taller and its chains run less level; the main-thread pause stays under a second within the budget and about half a second for the tenant's project past it. A board narrowed to a selection's chains stays small and keeps the compact drawing. The visual tier's board (17 nodes, 16 edges) is well within the budget, so its baselines do not change.

**Rejected.** Brandes-Köpf always (72% taller on the 77-model project, and network simplex is affordable there); a Web Worker alone (the board would still wait twenty seconds and growing, and ADR 0103's one-entry-point argument for the bundled build still holds; it stays open for far larger projects); a time budget that falls back (the same graph would draw differently on slower machines and flake the visual tier); lowering thoroughness (measured, no help).

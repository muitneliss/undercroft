---
title: ADR 0103 The Lineage Board Is Laid Out by ELK
type: source
date: 2026-10-01
tags: []
source: docs/adr/0103-the-lineage-board-is-laid-out-by-elk.md
source_path: docs/adr/0103-the-lineage-board-is-laid-out-by-elk.md
source_hash: 2b4f2078cbc233ca81e5503304378c622e0f4b686d1edf074a4712d8f5c826f7
ingested: 2026-10-01
---

# ADR 0103 The Lineage Board Is Laid Out by ELK

The lineage board's card places and wire lines now come from the Eclipse Layout Kernel's layered algorithm (`elkjs`, in `apps/ui/src/lib/lineageArrange.ts`), superseding the rejected option "a second library for layout (dagre, elk)" of [[ADR 0097 Lineage Is Drawn on a Board the Reader Arranges]] and its barycentre ordering of the board. Measured on a real tenant's project (77 nodes, 242 declared edges, twelve columns), 195 of the 242 single curves the old board drew ran over a card that was neither of their ends, so a reader tracing an inked chain could not tell which card a wire entered. Ordering cards cannot fix that; it needs a router that treats each column's cards as obstacles.

Decision. A column is still the longest declared chain below a node ([[ADR 0092 Lineage Draws Only Declared Relations]]): every card is handed to ELK already standing in its column, with `INTERACTIVE` layering and cycle breaking, so ELK keeps those layers and reverses only an edge pointing back across them. The board is one layout rather than one per disconnected part, which ELK would otherwise start each at its own first layer, moving a model with no declared upstream into the raw lake's column. ELK decides the order within a column, the vertical places and the line each edge runs along -- splines with network-simplex placement, chosen over orthogonal routing (a grid of parallel lines, and buses would ink a whole trunk for one chain) and Brandes-Köpf placement (72% taller). A wire keeps ELK's line only while both its cards stand where ELK put them; after a drag it is a plain curve, and "reset layout" restores both. ELK is a lazily loaded chunk (1.4 MB minified, 438 kB gzipped); the board shows a skeleton until it answers and reads the answer by subscription (`useSyncExternalStore`), not Suspense, because selecting a node is a router transition and a suspending transition would hold the whole page. A layout ELK cannot produce is said, not guessed; the text beneath, which keeps `layout`'s order and never waits for ELK, still says what each model reads.

Consequences: `elkjs` 0.12.0 (EPL-2.0 or GPL-3.0-or-later) is a new dependency; the whole project lays out in about 0.4 s on the main thread, once per drawing, the answer kept per pair of graphs; columns no longer stand at a fixed pitch, each heading over its own cards; the board's 1440 px visual baseline changes. Rejected: routing edges ourselves, dagre (no supported way to keep given layers), ELK in a Web Worker (a different entry point in the browser, the Bun suite and the visual tier; left open if a larger project makes the pause matter), and ELK's own layering (it ranks by a measure other than the chain from the raw lake).

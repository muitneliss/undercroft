---
title: ADR 0117 The Village Is an Overview of the Journal, and Replaces No Drawing
type: source
date: 2026-10-08
tags: []
source: docs/adr/0117-the-village-is-an-overview-and-replaces-no-drawing.md
source_path: docs/adr/0117-the-village-is-an-overview-and-replaces-no-drawing.md
source_hash: 3fc0903993a6b491e4bf9336420a0b50b141629b4163cd3020d4dc18ee8b0e41
ingested: 2026-10-08
---

# ADR 0117 The Village Is an Overview of the Journal, and Replaces No Drawing

Withdraws the half of [[ADR 0116 The Journal Can Be Read as a Village, Drawn in WebGL and Moved in Stop-Motion]] that redrew every node-and-edge drawing as a village, and keeps the other half: the Journal's village view at `?view=village`, its cast, look, stop-motion, boundary and rejections. Reinstates [[ADR 0097 Lineage Is Drawn on a Board the Reader Arranges]]'s board the reader pans, zooms and rearranges and [[ADR 0100 The Lineage Board's Selected Chains Flow]]'s beads on the selected chains, with the run map's live edge as the earlier exception to [[ADR 0014 Frames Are Size, Nothing Eases]]; [[ADR 0103 The Lineage Board Is Laid Out by ELK]] is unchanged.

Context. The owner's reading after 0116 shipped: the village is for high-level data visualisation and should not replace anything. The Journal's village is a glance for a reader who does not know the platform's vocabulary; nothing is read off it precisely and the work list carries every fact. A run's stage map and the lineage are working tools: tracing one model through sixty needs pan, zoom, drag, a minimap and "Reset layout", which a fixed camera fitting the whole graph gave up, leaving a small building reachable only through the words beside it.

Decision. The village is a high-level view of the Journal only and replaces no drawing. `RunFlow` and `LineageCanvas` return to React Flow (`@xyflow/react` exact-pinned at 12.11.6) as they were before 0116, with their code, styles, catalogue keys and visual baselines. The graph half of the village runtime (graph world, parts, carriers, the graph-to-buildings mapping) is removed rather than kept unused; the film, kit and town stay. Drawing another screen as a village is a new decision: it may sit beside a view as its overview, never in its place.

Rejected: a switch between board and village on each graph (two drawings to keep correct and baseline for a picture nobody reads precisely), adding pan and zoom to the graph villages (rebuilds React Flow inside WebGL), leaving the graph runtime unused in the tree (drifts and invites rewiring without a decision), and editing ADR 0116 (accepted ADRs are immutable). Consequences: `@xyflow/react` and its stylesheet return; `three` stays only in the Journal village's chunk, so opening a run or the lineage loads none of it; the run map's and lineage's baselines are the pre-0116 pictures and no longer need the WebGL timeout; the village design doc, `apps/ui/DESIGN.md` and the `village-animation` skill describe the village as the Journal's overview only.

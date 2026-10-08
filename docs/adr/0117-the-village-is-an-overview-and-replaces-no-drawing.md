# 117. The village is an overview of the Journal, and replaces no drawing

- Status: Accepted
- Date: 2026-10-08
- Supersedes: from [ADR 0116](0116-the-journal-can-be-read-as-a-village.md), its section "Every
  node-and-edge drawing is a village", its second "Supersedes" line, and in its Consequences the
  clauses that a reader loads the village "by opening a run or the lineage" and that
  `@xyflow/react` leaves the app's dependencies
- Reinstates: [ADR 0097](0097-lineage-is-drawn-on-a-board-the-reader-arranges.md)'s board the
  reader pans, zooms and rearranges, [ADR 0100](0100-the-lineage-selection-flows.md)'s beads on
  the selected chains, and the run map's live edge that ADR 0100 cites as the earlier exception
  to [ADR 0014](0014-frames-are-size-motion-is-stepped.md)
- Keeps: everything else in ADR 0116 -- the Journal's village view at
  `/tenants/:id/journal?view=village`, its cast, its look, its stop-motion, its boundary and its
  rejections -- and [ADR 0103](0103-the-lineage-board-is-laid-out-by-elk.md) unchanged

## Context

ADR 0116 did two things. It gave the Journal a second way of being read, a village of people at
work, opt-in through the URL, beside the ledger. And it redrew the interface's two node-and-edge
drawings, a run's stage map (`RunFlow`) and the models' lineage (`LineageCanvas`), as villages
too, removing `@xyflow/react` from the app.

The owner's reading after it shipped: the village is for data visualisation at a high level, and
it should not replace anything. The two halves of ADR 0116 serve different readers.

- **The Journal's village is a glance.** It answers "is anything happening for this customer, and
  is anything wrong" for someone who does not know the platform's vocabulary. Nothing is read off
  it precisely; the work list beside it carries every fact.
- **A stage map and a lineage are working tools.** A reader opens the lineage to trace one model
  through sixty, and needs to pan to it, zoom in on its column, drag a card out of the way, keep
  their place on a minimap and reset the layout afterwards. ADR 0097 gave the board those
  controls because a fixed picture of a real project could not be read, and ADR 0100's beads
  answered a reader who lost the selected chain among hundreds of wires. A village with a fixed
  camera that fits the whole graph gave all of that up, and a building too small to read on a
  large project could be reached only through the words beside it.

Replacing a precise drawing with a picture made the picture compete with the thing it was meant
to summarise.

## Decision

**The village is a high-level view of the Journal, and only that. It replaces no drawing.**

- The Journal's village stays exactly as ADR 0116 decided it: `Village.tsx`, the town world,
  the KayKit assets, `three` in its lazy chunk, the asset pipeline and its visual baselines.
- A run's stage map and the models' lineage return to React Flow (`@xyflow/react`, exact-pinned
  at 12.11.6), as they were before ADR 0116: the run map's plates and live edge, and the
  lineage's board with pan, zoom, drag, minimap, "Reset layout", its cards and its flowing
  selection. Their code, styles, catalogue keys and visual baselines are restored as they were.
- The graph half of the village runtime is removed rather than kept unused: the graph world, its
  parts, its carriers and the mapping from a graph to buildings and roads. The film, the kit and
  the town stay; they served the Journal before the graphs were added and serve it alone now.
- A future proposal to draw some other screen as a village is a new decision, and starts from
  this one: the village may sit beside a view as its overview, never in its place.

## Options rejected

- **Keep both, with a switch between the board and the village on each graph.** Two drawings of
  every graph means two to keep correct, test and baseline, for a picture nobody reads precisely.
  The lineage's text list and details already say everything a glance would.
- **Keep the graph villages and add pan and zoom to them.** That rebuilds React Flow's viewport,
  dragging and minimap inside a WebGL scene, with its own keyboard model, and still draws a card
  of words as a building a reader has to decode. The library that already does it well was the
  one removed.
- **Leave the graph runtime in the tree, unused, for later.** Code with no caller is not tested
  by use, drifts from the town it shares a film with, and invites a reader to wire it back in
  without this decision. It is in the history if it is wanted.
- **Edit ADR 0116 to remove the section.** Accepted ADRs are immutable; the reasoning that
  produced the graph villages, and why it was reversed, both stay readable.

## Consequences

- `@xyflow/react` and its stylesheet return to the UI. `three` stays, still admitted only into
  the Journal village's chunk: opening a run or the lineage loads none of it.
- `RunFlow.tsx`, `LineageCanvas.tsx`, `LineageCards.tsx`, `lib/runFlowLayout.ts` and
  `lib/lineageBoard.ts` are back as they were before ADR 0116, with `runFlowLayout.test.ts`.
  `VillageGraph.tsx` and `lib/village/{graph,graphParts,graphWorld,carriers}.ts` are gone, and
  `village.test.ts` pins the Journal's village only.
- The run map's and the lineage's visual baselines are the pre-ADR 0116 pictures again; the
  Journal village's two baselines stand. Those graph screens no longer need the WebGL test
  timeout.
- `docs/design/village.md`, `apps/ui/DESIGN.md` and the `village-animation` skill describe the
  village as the Journal's overview only.

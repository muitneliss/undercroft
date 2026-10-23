---
title: 'Design: The Village, the Journal Drawn as People at Work'
type: source
date: 2026-10-23
tags: []
source: docs/design/village.md
source_path: docs/design/village.md
source_hash: 14bbb60c158d7227061d2ca7dd66d541f6114e964928268a8ebac16d09aea446
ingested: 2026-10-23
---

# Design: The Village, the Journal Drawn as People at Work

The concept document for the Journal's village ([[ADR 0116 The Journal Can Be Read as a Village, Drawn in WebGL and Moved in Stop-Motion]]), kept by [[ADR 0117 The Village Is an Overview of the Journal, and Replaces No Drawing]] to a high-level view of one customer's Journal that replaces nothing.

* **Direction.** A reader who does not know the words watches data arrive, be kept and be made into something. Stop-motion at 10 fps. Nothing moves without a run.
* **Visual language.** Surfaces lie along the design-system tonal ramps by family (Grass, Sienna, Bone/Ink, Teal, Ultramarine, Violet, Oxide, Chrome). Roads are Page. Ink outlines; canonical division hues only on roofs and flags; vermilion only on slips. The scene is photographed as a miniature: a warm key light, soft shadows, ambient occlusion, tilt-shift, page grain. Ambience (clouds, windmill, watermill, flags) claims nothing.
* **Machinery driven by a run.** Kept apart from the ambience in `lib/village/works.ts`: the gatehouse's doors open while a courier is fetching, the bell swings when a scheduled run opens, the copyist's lectern turns its page while an extract copies, and the lumbermill's saw turns while a build runs. Each is read from the scene's characters alone; under reduced motion the doors are put where they end up and the rest holds still.
* **Town layout and cast.** One building per division along the data path, with dressing; the workshop has a lumbermill beside it. Courier, keeper, copyist (the hooded rogue, for `extract` runs), scribe (the mage, for `semantic` and `semantic-init`, casting as it sorts documents by kind), artisan (hammering, then sawing at the lumbermill), inspector, carter and the bell, driven by the evidence table over `script.ts`. A worker whose running run last said `run_waiting` sits at home rather than appearing at work.
* **What the village does not draw.** A run's stage map and the models' lineage are node-and-edge working tools (pan, zoom, drag, minimap, precise reading) and stay on React Flow ([[ADR 0097 Lineage Is Drawn on a Board the Reader Arranges]]); no village replaces them or any other view.
* **Access.** `aria-hidden` canvas, `aria-busy` frame, words beside it, `data-lit` answering pointing. Pointing at a figure or a building also shows a hover card above it: a figure's role, what they are doing, for whom and since when, or a building's name and the division it opens. The card is DOM text over the canvas, follows a walking figure at 10 fps, stays inside the frame, and is `aria-hidden` because it repeats the row.
* **Live data, budgets, assets, visual regression.** Polling at the Journal's rates; about 1.7 MB of models, fetched only when the view opens; supersampled; disposed on close; two settled-frame baselines of the Journal's village.

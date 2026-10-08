---
title: 'Design: The Village, the Journal Drawn as People at Work'
type: source
date: 2026-10-08
tags: []
source: docs/design/village.md
source_path: docs/design/village.md
source_hash: f2c150f2632e248a7ac1017ead1f9fc475297105aa5e977c7a170a54f86d9935
ingested: 2026-10-08
---

# Design: The Village, the Journal Drawn as People at Work

The concept document for the Journal's village ([[ADR 0116 The Journal Can Be Read as a Village, Drawn in WebGL and Moved in Stop-Motion]]), kept by [[ADR 0117 The Village Is an Overview of the Journal, and Replaces No Drawing]] to a high-level view of one customer's Journal that replaces nothing.

* **Direction.** A reader who does not know the words watches data arrive, be kept and be made into something. Stop-motion at 10 fps. Nothing moves without a run.
* **Visual language.** Surfaces lie along the design-system tonal ramps by family (Grass, Sienna, Bone/Ink, Teal, Ultramarine, Violet, Oxide, Chrome). Roads are Page. Ink outlines; canonical division hues only on roofs and flags; vermilion only on slips. The scene is photographed as a miniature: a warm key light, soft shadows, ambient occlusion, tilt-shift, page grain. Ambience (clouds, windmill, watermill, flags) claims nothing.
* **Town layout and cast.** One building per division along the data path, with dressing. Courier, keeper, scribe, artisan, inspector, carter and the bell, driven by the evidence table over `script.ts`.
* **What the village does not draw.** A run's stage map and the models' lineage are node-and-edge working tools (pan, zoom, drag, minimap, precise reading) and stay on React Flow ([[ADR 0097 Lineage Is Drawn on a Board the Reader Arranges]]); no village replaces them or any other view.
* **Access.** `aria-hidden` canvas, `aria-busy` frame, words beside it, `data-lit` answering pointing.
* **Live data, budgets, assets, visual regression.** Polling at the Journal's rates; about 1.3 MB of models, fetched only when the view opens; supersampled; disposed on close; two settled-frame baselines of the Journal's village.

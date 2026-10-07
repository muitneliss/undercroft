---
title: 'Design: The Village, the Journal Drawn as People at Work'
type: source
date: 2026-10-07
tags: []
source: docs/design/village.md
source_path: docs/design/village.md
source_hash: 0dea6d76a145fb3e191f689355e59012809da9cc5c14d8392abcb997f73891dd
ingested: 2026-10-07
---

# Design: The Village, the Journal Drawn as People at Work

The concept document for the village ([[ADR 0116 The Journal Can Be Read as a Village, Drawn in WebGL and Moved in Stop-Motion]]): the Journal's town, and the node-and-edge drawings drawn the same way.

* **Direction.** A reader who does not know the words watches data arrive, be kept and be made into something. Stop-motion at 10 fps. Nothing moves without a run.
* **Visual language.** Surfaces lie along the design-system tonal ramps by family (Grass, Sienna, Bone/Ink, Teal, Ultramarine, Violet, Oxide, Chrome). Roads are Page. Ink outlines; four stepped tones; canonical division hues only on roofs; vermilion only on slips. The scene is photographed as a miniature: a warm key light, soft shadows, ambient occlusion, tilt-shift, page grain. Ambience (clouds, windmill, watermill, flags) claims nothing.
* **Town layout and cast.** One building per division along the data path, with dressing. Courier, keeper, scribe, artisan, inspector, carter and the bell, driven by the evidence table over `script.ts`.
* **Node-and-edge drawings.**
  * Run map: stalls, the hall, the workshop and the vault per stage; a road from each stage to the next; a courier out of a working stage.
  * Lineage: model houses, raw storehouses and missing-dependency ruins; roads along ELK's routes, inked upstream, dashed downstream, faint when dimmed, broken from a missing dependency; carts on the selected chains.
  * The camera is fixed and fits the whole graph; presses select or clear.
* **Access.** `aria-hidden` canvas, `aria-busy` frame, words beside it, `data-lit` answering pointing.
* **Live data, budgets, assets, visual regression.** As before: polling at the Journal's rates; about 1.3 MB of models; supersampled; disposed on close; settled-frame baselines.

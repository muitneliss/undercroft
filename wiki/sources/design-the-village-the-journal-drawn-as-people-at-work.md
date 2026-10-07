---
title: 'Design: The Village, the Journal Drawn as People at Work'
type: source
date: 2026-10-07
tags: []
source: docs/design/village.md
source_path: docs/design/village.md
source_hash: 3db436c7423fc5cadd4248d36ee665de162915616fd3f34f80a51d73bed39126
ingested: 2026-10-07
---

# Design: The Village, the Journal Drawn as People at Work

The concept document for the Journal's village view ([[ADR 0115 The Journal Can Be Read as a Village, Drawn in WebGL and Moved in Stop-Motion]]). It owns the cast, the layout, the visual language and the mapping from runs to actions.

* **Direction contract.** A reader who does not know the words watches data arrive, be kept and be made into something. Stop-motion at 10 fps. Nothing moves without a run.
* **Visual language.** Every surface lies along a design-system tonal ramp by family:

  * Grass for fields and trees
  * Sienna for timber and skin
  * Bone and Ink for stone
  * Teal for the glossy lake
  * Page for the roads

  Ink outlines, finer on characters. The scene is photographed like a miniature (`look.ts`): a warm key light, soft shadows on the board and the page, ambient occlusion, a tilt-shift focus band, page grain and a vignette. The repaint uses `_CELL`, `_SHADE` and the cell gradients; `village.test.ts` holds the ramps equal to `design.json` and every vertex along them.
* **Ambience** (`ambience.ts`). Drifting cloud shadows, two small clouds, windmill sails, a watermill wheel and division flags. It claims nothing and holds still under reduced motion.
* **Layout.** Buildings run left to right along the data path, one per division, with dressing (props, trees, lake plants), the watermill, and a flag per division. Roads follow the connections.
* **Cast.** Courier, vault keeper, scribe, artisan, inspector, carter, and the bell, all printed in the ramps.
* **Evidence table.** It maps each rule in `script.ts` to what the village shows. dbt reports steps only at the end.
* **Access.** The canvas is `aria-hidden` and the frame `aria-busy` until loaded. A work list and a buildings list carry the words, and `data-lit` answers pointing.
* **Live data.** `runs.list` every 5 or 15 s, `runs.events` every 1 s, `runs.get` once for the newest closed build, and `connections.list`.
* **Budgets.** About 1.3 MB of models; at most 10 draws a second; 2 to 3 times supersampled; disposed on close.
* **Visual regression.** Two settled-frame baselines.

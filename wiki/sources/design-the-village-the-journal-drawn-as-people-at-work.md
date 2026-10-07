---
title: 'Design: The Village, the Journal Drawn as People at Work'
type: source
date: 2026-10-07
tags: []
source: docs/design/village.md
source_path: docs/design/village.md
source_hash: 48fb9db3fbeff0eff505cbb74728c401baa0f423cb2a0e2f821d0042f0aee33f
ingested: 2026-10-07
---

# Design: The Village, the Journal Drawn as People at Work

The concept document for the Journal's village view ([[ADR 0115 The Journal Can Be Read as a Village, Drawn in WebGL and Moved in Stop-Motion]]). It owns the cast, the layout, the visual language and the mapping from runs to actions.

* **Direction contract.** THESIS: a reader who does not know the words can watch data arrive, be kept and be made into something, with refusals visibly set aside. OWN-WORLD: the design system's inks on KayKit models. MOTION: stop-motion at 10 fps, keyed that way at build time. TRUTH: nothing moves without a run; the picture may lag by one walk, the words never do.
* **Visual language.** Every surface is printed in the nearest step of a design-system tonal ramp, by hue family:

  * fields and trees in Grass
  * timber, skin and sand in Sienna
  * stone in Bone and Ink
  * water in Teal
  * roads in Page

  There are Ink outlines (finer on characters) and four stepped tones. Canonical division hues appear only on roofs, and vermilion only on slips. The repaint reads per-vertex `_CELL` and `_SHADE` against the cell gradients in `atlas.json`. `village.test.ts` holds the ramps equal to `design.json`, and holds that every vertex is in them.
* **Layout.** Buildings run left to right along the data path:
  * gatehouse with source roads: Sources
  * village sign: Customers
  * town hall and bell: Journal
  * stone vault with the lake behind it, reading room and archive: Raw lake
  * workshop: Models
  * printing house: Reports
  * houses: People
  * Dressing makes it lived in: props by each building, trees and rocks on the edges, lilies and reeds on the lake.
  * Roads follow the connections.
* **Cast.** Courier (Ranger), vault keeper (Rogue), scribe (Mage), artisan (Barbarian), inspector (Knight), carter (Ranger), and the bell, all printed in the ramps.
* **Evidence table.** It maps each rule in `script.ts` to what the village shows. dbt reports steps only at the end.
* **Access.** The canvas is `aria-hidden` and the frame `aria-busy` until loaded. The work list and the buildings list carry the words, and `data-lit` answers pointing.
* **Live data.** `runs.list` every 5 or 15 s, `runs.events` every 1 s for running runs, `runs.get` once for the newest closed build, and `connections.list`.
* **Budgets.** About 1.3 MB of compressed models; at most 10 draws a second; rendered at 2 to 3 times the screen's pixels and downscaled; about 100k triangles on a busy morning; disposed on close.
* **Assets.** See `apps/ui/src/assets/village/README.md`.
* **Visual regression.** Two settled-frame baselines in `Journal.vrt.test.tsx`.

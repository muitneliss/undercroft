---
title: 'Design: The Village, the Journal Drawn as People at Work'
type: source
date: 2026-10-07
tags: []
source: docs/design/village.md
source_path: docs/design/village.md
source_hash: cdacf19e305626e2e239977c1ff5da46c8db67aa76ea33f181503f7130c8ead5
ingested: 2026-10-07
---

# Design: The Village, the Journal Drawn as People at Work

The concept document for the Journal's village view ([[ADR 0115 The Journal Can Be Read as a Village, Drawn in WebGL and Moved in Stop-Motion]]). It owns the cast, the layout, the visual language and the mapping from runs to actions.

* **Direction contract.** THESIS: a reader who does not know the words can watch data arrive, be kept and be made into something, with refusals visibly set aside. OWN-WORLD: the book's tokens on KayKit models. MOTION: stop-motion at 10 fps, keyed that way at build time. TRUTH: nothing moves without a run; the picture may lag by one walk, the words never do.
* **Visual language.** Bone and Page ground, Ink outlines, stepped tones from one raking light, neutrals by lightness, roofs in their division's hue, characters neutral, water in teal lifted toward Bone, vermilion only on slips. The repaint works from a per-vertex `_CELL` and `atlas.json`, using tokens read off `index.css`; `village.test.ts` holds that no character can take a hue.
* **Layout.** Buildings run left to right along the data path:
  * gatehouse with source roads: Sources
  * village sign: Customers
  * town hall and bell: Journal
  * stone vault with the lake behind it, reading room and archive: Raw lake
  * workshop: Models
  * printing house: Reports
  * houses: People
  * The lake-API road comes from the south edge.
  * Roads follow the connections (up to five slots). A disconnected source has no road; a lapsed grant's road is barred with a slip.
* **Cast.** Courier (Ranger), vault keeper (Rogue), scribe (Mage), artisan (Barbarian), inspector (Knight), carter (Ranger), and the bell.
* **Evidence table.** It maps each derivation rule in `script.ts` to what the village shows:
  * fetching, waiting and barred states from the running ingest's last event
  * the keeper laying while anyone brings
  * failed runs under slips until a newer run
  * the hand-off while a child build runs
  * the scribe and the artisan for their run kinds
  * the inspector after a closed build with tests
  * carters for lake-API runs
  * the bell for a scheduled run opened in the last eight seconds
  * gauges for the vault pile, set-aside crates and finished pieces
  * dbt reports steps only at the end.
* **Access.** The canvas is `aria-hidden` and the frame `aria-busy` until loaded; a failure sentence replaces an empty box. The work list and the buildings list carry the words, and `data-lit` answers pointing.
* **Live data.** `runs.list` every 5 or 15 s, `runs.events` every 1 s for running runs, `runs.get` once for the newest closed build, and `connections.list`.
* **Budgets.** A `three`-only chunk; about 1 MB of compressed models; at most 10 draws a second; DPR of 2 or less; about 100k triangles on a busy morning; disposed on close.
* **Assets.** See `apps/ui/src/assets/village/README.md`.
* **Visual regression.** Two settled-frame baselines in `Journal.vrt.test.tsx`; software WebGL is repeatable.

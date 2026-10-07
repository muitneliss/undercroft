---
title: 'Design: The Village, the Journal Drawn as People at Work'
type: source
date: 2026-10-07
tags: []
source: docs/design/village.md
source_path: docs/design/village.md
source_hash: b657fe4afed2e57f54d33590c0f5786a4390bf5e121d653727ad48d98cba3880
ingested: 2026-10-07
---

# Design: The Village, the Journal Drawn as People at Work

The concept document for the Journal's village view ([[ADR 0115 The Journal Can Be Read as a Village, Drawn in WebGL and Moved in Stop-Motion]]). It owns the cast, the layout, the visual language and the mapping from runs to actions.

* **Direction contract.** THESIS: a reader who does not know the words can watch data arrive, be kept and be made into something, with refusals visibly set aside. OWN-WORLD: the book's stock, inks and wheel, on KayKit models repainted to the tokens. MOTION: stop-motion at 10 fps, one settled frame under reduced motion. TRUTH: nothing moves without a run; the picture may lag by one walk, the words never do.
* **Visual language.** Bone, Page and Leaf ground; Ink outlines; three stepped tones from one raking light; roofs in their division's hue; characters in Bone and Ink; water in teal lifted toward Bone; vermilion only on errata slips. No shadows, fog, bloom or depth of field. The camera is fixed, orthographic and isometric.
* **Layout.** One building per division along the data path:

  * gatehouse and roads: Sources, chrome
  * town hall and bell: Journal, grass
  * stone vault on the lake, with a reading room and an archive: Raw lake, teal
  * workshop: Models, violet
  * printing house: Reports, sienna
  * houses: People, ultramarine
  * village sign: Customers, oxide

  Each road belongs to a connection, and a lapsed grant bars its road with a slip.
* **The cast**, from the free KayKit Adventurers:
  * the bell (a prop) for schedule ticks
  * Courier (Ranger) for ingest and the lake-API handcart
  * Vault keeper (Rogue) for landing and load
  * Scribe (Mage) for extract and semantic runs
  * Artisan (Barbarian) for transform and build
  * Inspector (Knight) for dbt tests
* **Evidence table.** It maps each run event to an action: `run_opened` by trigger, `run_waiting`, `entity_started`, `entity_not_granted`, the gauges, `documents_landed`, refusals, `entity_done`, the extract and semantic progress, the child run hand-off via `parent_run_id`, `run_step` model and test, `no_models`, `run_closed`, `run_failed`, `run_stopped`, and connection `expired`. Closed runs are not replayed; the latest closed run per source leaves a trace.
* **Access.** The canvas is `aria-hidden`; a DOM work list and proof slips carry the text; names are i18n keys, Vietnamese first.
* **Live data.** It polls `runs.list` every 5 s while a run is running and every 15 s otherwise, `runs.get` and `runs.events` at the Journal's rates, and `connections.list`.
* **Budgets.** A `three`-only chunk; 2 MB or less of compressed models; 60,000 triangles or fewer; 10 draws a second at most; DPR of 2 or less; disposed on close.
* **Assets.** Downloaded by hand from itch.io, subset, repainted and compressed by a task-run script, committed with `LICENSE.txt` and `PROVENANCE.md`.
* **Phases.** Docs; the scene; the characters; ingest; build; the rest; connected.
* **Open questions.** When `run_step` rows are written; whether headless WebGL is deterministic; how to repaint the atlas.

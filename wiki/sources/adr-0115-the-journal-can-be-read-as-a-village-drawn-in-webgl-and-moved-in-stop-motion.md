---
title: >-
  ADR 0115 The Journal Can Be Read as a Village, Drawn in WebGL and Moved in
  Stop-Motion
type: source
date: 2026-10-07
tags: []
source: docs/adr/0115-the-journal-can-be-read-as-a-village.md
source_path: docs/adr/0115-the-journal-can-be-read-as-a-village.md
source_hash: c4987d292b605b549dab0acfbd5a6456940d53e15e2cb5f3c84ac0c40d65e163
ingested: 2026-10-07
---

# ADR 0115 The Journal Can Be Read as a Village, Drawn in WebGL and Moved in Stop-Motion

Adds a village view to the Journal at `/tenants/:id/journal?view=village`, beside the ledger, which stays the default and the content. Supersedes two rejections in [[ADR 0063 The Public Cover Moves Continuously]], "a motion library or WebGL" and "extending the exception to the app", for this view only. ADR 0014's stepped rule is applied in three dimensions, not superseded.

Decision.

* One customer, live, reading only `runs.list`, `runs.get` and `runs.events` with the reader's own session.
* Nothing moves without a run behind it: each character's action is a pure derivation from run status, events and steps, tested outside WebGL.
* Stop-motion on a stepped 10 fps clock.
* `three`, exact-pinned, only in the lazy village chunk, with an imperative runtime outside React state.
* A model village on a desk, photographed like a crafted miniature (`look.ts`):
  * every colour lies along a design-system tonal ramp by hue family and lightness, keeping KayKit's gradients, with paper grain;
  * a warm key light, a sky-and-grass fill, and a room reflected in the lake;
  * soft shadows on the board and onto the page beneath it, plus ambient occlusion;
  * Ink outlines, a tilt-shift band of focus, and page grain with a corner falloff.
* "Rules, never shadows" governs the book's sheets; the village is an object on the desk, so it casts one.
* Weather and machinery (clouds, windmill, watermill, division flags) move on their own and claim nothing. Under reduced motion they hold still.
* A division's canonical hue is worn only by its building's roof and flag, which opens it. Vermilion appears only on slips.
* KayKit CC0 assets with provenance, repainted by a task-run script.
* A fixed orthographic camera.
* A wordless, `aria-hidden` canvas, with a work list and a buildings list carrying the words.

Rejected: `@react-three/fiber`, smooth 60 fps, an eighth division (ADR 0019), a cross-customer village (deferred), characters built from primitives, a push channel (ADR 0021).

Consequences: `three` and the asset tools are added, exact-pinned; `.glb` joins the content-type allow-list; every pass is deterministic, so the visual-regression tier keeps a settled frame including the canvas; `docs/design/village.md` owns the cast; DESIGN.md describes the village.

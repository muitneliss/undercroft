---
title: >-
  ADR 0115 The Journal Can Be Read as a Village, Drawn in WebGL and Moved in
  Stop-Motion
type: source
date: 2026-10-07
tags: []
source: docs/adr/0115-the-journal-can-be-read-as-a-village.md
source_path: docs/adr/0115-the-journal-can-be-read-as-a-village.md
source_hash: 1d14b05b98b4d3bf2dd273373cb70875f8175b2b1213ce8056d308d0296c00ae
ingested: 2026-10-07
---

# ADR 0115 The Journal Can Be Read as a Village, Drawn in WebGL and Moved in Stop-Motion

Adds a village view to the Journal at `/tenants/:id/journal?view=village`, beside the ledger, which stays the default and the content. Supersedes two rejections in [[ADR 0063 The Public Cover Moves Continuously]], "a motion library or WebGL" and "extending the exception to the app", for this view only. ADR 0014's stepped rule is applied in three dimensions, not superseded. Context: the Journal answers "is this customer's data flowing?" only for a reader who knows the vocabulary, and nothing draws all of a customer's runs and their hand-offs at once.

Decision.

* One customer, live, reading only `runs.list`, `runs.get` and `runs.events` with the reader's own session.
* Nothing moves without a run behind it: each character's action is a pure derivation from run status, events and steps, tested outside WebGL. A character at rest claims nothing.
* Stop-motion on a stepped 10 fps clock, with nothing interpolated.
* `three`, exact-pinned, only in the village's lazy chunk, with an imperative runtime outside React state, as the vault's is.
* A printed diorama in the book's tokens: Bone ground, Ink outlines, three-step toon shading from one raking light, no shadows. Roofs wear their division's hue and open that division. Characters wear neutrals only. Vermilion is only on errata slips.
* A KayKit CC0 subset is vendored with its licence and provenance, imported through Vite, and repainted by a task-run script.
* A fixed orthographic camera.
* The canvas is `aria-hidden` and wordless. A work list and a list of buildings carry the words. Pointing in the picture lights a row, and pressing goes where the row goes.

Boundary: opt-in through the URL; the loop runs only while visible; reduced motion paints one settled frame per poll; a WebGL or model failure puts a sentence in the frame; counts are never told by crates.

Rejected: `@react-three/fiber`, smooth 60 fps, an eighth division (ADR 0019), a cross-customer village (deferred), characters built from primitives, a push channel (ADR 0021).

Consequences:

* `three` joins the UI; the asset tools (gltf-transform, meshoptimizer, pngjs) join the root's dev dependencies, all exact-pinned.
* `.glb` joins the content-type allow-list.
* The visual-regression tier keeps a settled frame including the canvas: the frame is `aria-busy` until the models load, and software WebGL repeated pixel for pixel.
* `docs/design/village.md` owns the cast.
* DESIGN.md describes the village.

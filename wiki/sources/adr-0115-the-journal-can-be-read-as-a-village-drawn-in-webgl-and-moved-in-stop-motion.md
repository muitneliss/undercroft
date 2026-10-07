---
title: >-
  ADR 0115 The Journal Can Be Read as a Village, Drawn in WebGL and Moved in
  Stop-Motion
type: source
date: 2026-10-07
tags: []
source: docs/adr/0115-the-journal-can-be-read-as-a-village.md
source_path: docs/adr/0115-the-journal-can-be-read-as-a-village.md
source_hash: d8d9b826308d51087ba49d751e6f42d960855e182a901a7fa2887f725d3bae7e
ingested: 2026-10-07
---

# ADR 0115 The Journal Can Be Read as a Village, Drawn in WebGL and Moved in Stop-Motion

Adds a village view to the Journal at `/tenants/:id/journal?view=village`, beside the ledger, which stays the default and the content. Supersedes two rejections in [[ADR 0063 The Public Cover Moves Continuously]] ("a motion library or WebGL" and "extending the exception to the app") for this view only. It does not supersede ADR 0014; it applies ADR 0014's stepped rule in three dimensions. Context: the Journal answers "is this customer's data flowing?" only for a reader who knows the vocabulary (ingest, transform, child build, refusal), and nothing draws all of a customer's runs and the hand-offs between them.

Decision.

* One customer, live, reading only `runs.list`, `runs.get` and `runs.events` with the reader's own session.
* Nothing moves without a run behind it: each character's action is a pure derivation from `ops.run_event`, status and steps, tested outside WebGL. A character at rest claims nothing.
* Stop-motion on a stepped 10 fps clock, with nothing interpolated between frames.
* `three`, exact-pinned, only in the village's `React.lazy` chunk, with an imperative runtime outside React state, like the vault.
* A printed diorama in the book's tokens: Bone ground, Ink outlines, three-step toon shading from one raking light, no shadows. Roofs wear their division's hue and open that division (the Wheel Rule read literally). Characters wear Bone and Ink only. Vermilion is only on errata slips.
* A KayKit CC0 subset is vendored under `apps/ui/src/assets/village/` with its licence and provenance, imported through Vite for hashed URLs, and its atlas is repainted by a task-run script.
* A fixed orthographic isometric camera.
* The canvas is `aria-hidden` and carries no words. A DOM work list and proof slips carry the text, and pressing a character opens its run.

Boundary: opt-in via the URL; the loop runs only while visible; reduced motion paints one settled frame per poll; a WebGL or model failure renders an unprinted leaf with its reason; counts are never told by crates.

Rejected:

* `@react-three/fiber`: a React reconciler fights `no-usestate`.
* Smooth 60 fps.
* An eighth division (ADR 0019).
* A cross-customer village (deferred).
* Characters built from primitives in code (no rigged animation).
* A push channel (ADR 0021).

Consequences: `three` and a dev glTF tool are added as dependencies; the content-type allow-list learns `.glb`; the visual-regression tier covers only the DOM half until an experiment shows whether headless WebGL is deterministic; `docs/design/village.md` owns the cast; DESIGN.md gains a village heading when the view ships.

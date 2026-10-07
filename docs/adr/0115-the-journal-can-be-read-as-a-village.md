# 115. The Journal can be read as a village, drawn in WebGL and moved in stop-motion

- Status: Accepted
- Date: 2026-10-07
- Supersedes: for the Journal's village view only, two rejections in
  [ADR 0063](0063-the-public-cover-moves-continuously.md): "a motion library or WebGL" and
  "extending the exception to the app". ADR 0063 stands as written for the public cover. ADR
  [0014](0014-frames-are-size-motion-is-stepped.md) is not superseded. This ADR applies its
  stepped rule to a third dimension, and that rule constrains this ADR.

## Context

The Journal answers "is this customer's data flowing?" (ADR 0032). It answers well for a
reader who already knows the platform's vocabulary: an ingest run, the lake, a transform, a
child build, a refusal. It answers poorly for a reader who does not. They have to know that a
`transform` run with a `parent_run_id` is the build an ingest started before they can follow a
sync from a source to a report. `RunFlow` draws one run as plates. Nothing draws all of a
customer's runs at once, or the handoff between them.

The request was a picture of the whole platform at work, with characters doing each operation
in a small village, in the spirit of Kay Lousberg's KayKit packs. That picture has to be drawn
in three dimensions with rigged, animated models. A 2D canvas and about a hundred small shapes,
ADR 0063's budget, cannot hold it.

ADR 0063 rejected exactly this: "The app is an Operate surface. A reader mid-call is served by a
leaf that turns in four frames, not by a scene." That reasoning still holds for the reader
mid-call, so this ADR does not override it. The village is a second way of reading the Journal.
It does not replace the ledger.

## Decision

**The Journal gains a village view, `/tenants/:id/journal?view=village`, beside the ledger.**
The ledger stays the Journal's default and the content. The village is its picture, the same
relation as the cover's film to its two lists.

- **One customer, live.** The village shows the open customer's own runs. It reads only
  `runs.list`, `runs.get` and `runs.events` through the reader's own session, so every role
  gate and the 404-not-403 boundary apply unchanged.
- **Nothing moves without a run behind it.** Each character's action is derived from a
  `ops.run_event` row, a run's status, or its steps. That derivation is a pure function from
  the run data to a script, and the script's tests live outside WebGL. A character with no
  running run is at rest at home and claims nothing. This is rule 2 applied to a picture: a
  courier walking with nothing behind them is a wrong value nobody can see.
- **Stop-motion.** The scene renders on a stepped clock of 10 frames per second. Positions and
  skeletal poses are sampled on those frames and held between them. Nothing interpolates
  between frames. This is ADR 0014's claim that a thing is moved rather than animated, made in
  three dimensions. It also means 10 draws a second rather than 60.
- **WebGL through `three`**, exact-pinned. It is loaded only in the village's own `React.lazy`
  chunk, so no other route downloads a byte of it. The runtime is imperative and owns its
  values on a plain object, as the vault's does (`apps/ui/src/lib/vault/runtime.ts`). Nothing
  in the frame loop is React state (`state.md`). React passes it the query data and reads back
  nothing but `data-` attributes.
- **A printed diorama, in the design system's own inks.**
  - Every colour is a step of one of the design system's tonal ramps (`.impeccable/design.json`):
    a green takes Grass, a blue Ultramarine, a purple Violet, wood and skin Sienna, stone Bone
    and Ink, and so on, at the step nearest its lightness. KayKit's gradients survive as steps,
    so the models keep their detail and lose their own colours. Roads are Page.
  - Every model is outlined in Ink, a character more finely than a building.
  - Faces take four stepped tones from one raking light, by toon shading, with no smooth
    gradient.
  - Nothing casts a shadow ("Rules, never shadows").
  - A division's own hue, the canonical step of its ramp, is worn only by the roof and flag of
    the building that stands for that division, and pressing the building opens it. That is the
    Wheel Rule read literally: where the canonical hue appears, it names the division. A wheat
    field takes Chrome's other steps, never Chrome itself.
  - Vermilion is in no ramp the village paints from. It appears only on errata slips: a refused
    record set aside, a failed test, a failed run, a lapsed road.
- **KayKit models, CC0.** A subset of the free tiers of KayKit Adventurers, Character
  Animations and Medieval Hexagon is vendored under `apps/ui/src/assets/village/`, beside its
  licence and a provenance note: the pack, its version, and what was changed. The assets are
  imported through Vite, so every model gets a hashed, immutable URL. The atlas is repainted
  to the tokens by a script that `task` invokes. The repo never keeps the packs' original
  colours, and the full packs are never committed.
- **The camera is fixed.** It is an orthographic, isometric diorama with no orbit and no zoom.
  The reader has nothing to steer, so they never lose the picture.
- **The canvas carries no words.** It is `aria-hidden`. Every name and time is DOM text from the
  i18n catalogues: the work list beneath the scene, which names every character, what they are
  doing and for whom, with a link to the run, and the list of buildings with the division each
  opens. Pointing at a figure or a building in the picture lights its row; pressing it goes where
  the row goes. A keyboard reader uses the rows, so the canvas needs no focus of its own.

## The boundary

- The ledger remains the Journal's default. The village is opt-in, through the URL, so a
  reader who never asks for it never loads it.
- The loop runs only while the canvas is on screen and the tab is visible.
- Under `prefers-reduced-motion` the loop never runs. Each poll paints one settled frame that
  puts every character where its run says it is now, and nothing walks between frames. The
  preference means "move me less", not "tell me less" (ADR 0014).
- A failed WebGL context, or a model that does not load, puts a sentence saying so in the
  frame, above the work list, which still says who is doing what. It is not an empty canvas.
- A count is never told by how many crates are drawn. Crates are a gauge (ADR 0032), and the
  figure lives only in DOM text, in mono, through the reader's locale.

## What this rejects

- **`@react-three/fiber`.** It is a React reconciler, so the scene's state would live in
  React. Every frame would be a render, and the `no-usestate` rule would be fighting the
  library's idiom. The vault already shows that an imperative runtime with a plain object is
  enough.
- **Smooth 60fps.** It reads as a game and abandons ADR 0014's one expressive variable for the
  sake of fluency. Ten frames a second is legible, honest about being stepped, and cheaper.
- **An eighth division.** The wheel is full (ADR 0019), and the village is a way of reading the
  Journal, not a section of the book.
- **A whole-platform village across customers.** It needs a cross-tenant read that no role has
  today. Deferred, not refused.
- **Characters built from primitives in code.** That avoids binary assets but cannot carry
  rigged animation, which is the point of the request.
- **A push channel for the village.** ADR 0021 already rejected SSE for run evidence. The
  village polls what the Journal polls.

## Consequences

- `three` joins the UI's dependencies and is admitted only into the village chunk. The asset
  script's tools join the root's dev dependencies: `@gltf-transform/core`, `functions` and
  `extensions`, `meshoptimizer` and `pngjs`. All are exact-pinned.
- The control plane's content-type allow-list learns `.glb`.
- The visual-regression tier forces reduced motion, so a village baseline is a settled frame:
  canvas, work list and buildings in one picture. The tier waits for it, because the frame is
  `aria-busy` until the models load. The Playwright image's software WebGL painted the same
  pixels in a baseline run and a later comparison run, so the canvas is kept in the baseline.
  If it ever stops being repeatable, the fix is a narrower baseline, not a looser tolerance.
- `docs/design/village.md` owns the cast, the layout and the mapping from each operation to
  what a character does. A change to what the village claims starts in the script's tests.
- `apps/ui/DESIGN.md` describes the village under its own heading.

# 63. The public cover moves continuously, and nothing else does

- Status: Accepted
- Date: 2026-09-26
- Supersedes: for the public cover at `/` only, the sentence of
  [ADR 0014](0014-frames-are-size-motion-is-stepped.md) that rejects "easing, at every tier",
  and its rejection of a pointer-driven value. The rest of ADR 0014 stands for every other
  surface, the paper sections below the cover included.

## Context

The public home at `/` introduced the data path as a static four-column list
(`docs/design/homepages.md`). It was asked to become a motion piece that answers the pointer in
any direction and shows the data flow and the user flow in strong contrast.

ADR 0014 makes every transition `steps(n, end)`, with the frame count as the size of the thing
that moved. A stepped version of a pointer-driven scene was offered first: a plotter that
snaps to the pointer rather than following it. The decision was the continuous one, for the
cover alone. A stepped pointer reads as lag. Unlike a leaf turning or a slip tipping in, a
lamp has no discrete size to count frames by.

## Decision

The cover is a canvas film of the platform's own rules, and it is the one surface where motion
is continuous:

- **The vault.** Round arches recede to a vanishing point that swings away from the pointer and
  drift toward the viewer. They are stroked with a gradient centred on the pointer, so the stone
  can be read only where the lamp is held. Ink ground and Bone data are the palette's two ends.
- **The data path**, from `apps/ui/src/lib/vault/`. Four sources send records to one gate,
  which admits them one at a time (one writer). The lake lays a block per new content hash, and
  a repeat lands on its original instead of laying a copy (content-addressed, create-only). The
  table reads copies. A refused copy is kept, struck, in a tray instead of being dropped (never
  guess). Models make one row of three, and the report's bars grow. A test pins each of these
  claims, so the picture cannot quietly start saying something else.
- **The user flow**, the six steps from an invitation to a question. The pointer carries the
  reader along it, or the reader walks by itself. Each step it crosses acts on the data, and a
  thread is drawn from the step up to what it moved. Pressing the flow is a run.
- **The pointer is a lamp.** It lights the vault and the nearest data, parts records around
  itself, tints the column it is over in that division's lifted wheel hue, and shows a proof
  slip (`sha256:…`, the source) for the record under it.

The film's own small state changes, a stage lit or a step reached, ease at its pace with
`cubic-bezier(0.16, 1, 0.3, 1)`. That curve is written once, as `--cover-ease` in
`apps/ui/src/styles/landing-cover.css`.

## The boundary

- `index.css` still contains no `cubic-bezier`. Every surface behind sign-in and the paper
  sheet below the cover stay stepped.
- The film is not React state. It keeps its values on a `VaultFilm` object and writes only
  `data-lit` and `data-state` attributes, and only when they change (`state.md`).
- The film loops only while the cover is on screen and the tab is visible.
- Under `prefers-reduced-motion` it never loops. It paints one settled frame and repaints it
  when the pointer moves: the lamp and proof slips still answer, nothing travels, and nothing
  parts or trails.
- The ordered lists are the content: four stages and six steps. The canvas is `aria-hidden`
  and carries no word the lists do not.

## What this rejects

- **A stepped lamp.** Reasoned above.
- **A motion library or WebGL.** A 2D canvas, `requestAnimationFrame` and about a hundred small
  shapes is the whole budget. ADR 0014's reason for no library still holds.
- **Motion on scroll.** Nothing reacts to scroll position, as ADR 0014 decided.
- **Extending the exception to the app.** The app is an Operate surface. A reader mid-call is
  served by a leaf that turns in four frames, not by a scene.

## Consequences

- The cover is dark: the header and cover remap the book's own tokens (Ink to Bone, Leaf to the
  ground), so plates, links and focus rings invert by their existing rules.
- A change to the film's claims starts in `apps/ui/src/lib/vault/vault.test.ts`.

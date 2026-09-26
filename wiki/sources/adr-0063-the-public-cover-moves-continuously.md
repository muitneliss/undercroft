---
title: ADR 0063 The Public Cover Moves Continuously
type: source
date: 2026-09-26
tags: []
source: docs/adr/0063-the-public-cover-moves-continuously.md
source_path: docs/adr/0063-the-public-cover-moves-continuously.md
source_hash: 4c38c8838de90d7bc66e24e2cbf2f401e5266ae3aa49abd6bf1aa9ff68c3e042
ingested: 2026-09-26
---

# ADR 0063 The Public Cover Moves Continuously

# ADR 0063 The Public Cover Moves Continuously

## Decision

The public home at `/` becomes a canvas film, the one surface where motion is continuous
rather than stepped. It supersedes, **for the cover only**, [[adr-0014-frames-are-size-nothing-eases]]'s
rejection of easing and of pointer-driven values. Every other surface, including the paper
sections below the cover, stays `steps(n, end)`.

* **The vault:** round arches recede to a vanishing point that swings away from the pointer,
  drifting toward the viewer, stroked with a gradient centred on the pointer so the stone
  reads only where the lamp is held.
* **The data path** (`apps/ui/src/lib/vault/`): four sources, one gate admitting one record at
  a time (one writer), a lake that lays one block per new content hash and echoes a repeat
  onto its original (create-only, content-addressed), copies read by the table with refusals
  kept struck in a tray (never guess), models making one row of three, and growing report
  bars. Each claim is pinned by `vault.test.ts`.
* **The user flow:** six steps from invitation to question. The pointer carries the reader
  (or it walks alone); each crossed step acts on the data and a thread links it to what it
  moved. Pressing the flow is a run.
* **The pointer is a lamp:** it lights the vault and nearby data, parts records around
  itself, tints the column under it in that division's lifted hue, and shows a `sha256:`
  proof slip.

The film's small state changes use `--cover-ease` (`cubic-bezier(0.16, 1, 0.3, 1)`), declared
once in `landing-cover.css`.

## Boundary

* `index.css` still has no `cubic-bezier`; the app and the paper sheet stay stepped.
* The film holds no React state: a `VaultFilm` object writes only `data-lit` / `data-state`.
* It loops only while the cover is visible and the tab is shown.
* Reduced motion paints one settled frame, repainted on pointer move; nothing travels.
* The ordered lists (four stages, six steps) are the content; the canvas is `aria-hidden`.

## Rejected

A stepped lamp (reads as lag; a lamp has no size to count frames by), a motion library or
WebGL, motion on scroll, and extending the exception into the Operate surfaces.

## Consequences

The header and cover remap the book's tokens onto Ink so controls invert by their existing
rules. Changes to what the film claims start in `apps/ui/src/lib/vault/vault.test.ts`.

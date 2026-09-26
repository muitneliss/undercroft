---
title: ADR 0066 One Ground and One Light for the Public Home
type: source
date: 2026-09-26
tags: []
source: docs/adr/0066-one-ground-and-one-light-for-the-public-home.md
source_path: docs/adr/0066-one-ground-and-one-light-for-the-public-home.md
source_hash: d4f8f96d605f987d77ee20bcdd0ff9c2f24ec5e38a0eb19c994291a4f1d6fba0
ingested: 2026-09-26
---

# ADR 0066 One Ground and One Light for the Public Home

# ADR 0066 One Ground and One Light for the Public Home

## Decision

Supersedes [[adr-0065-the-lamp-lights-the-whole-public-home]]'s sentence that the cover's film
paints its own ground and draws its own lamp. The home has one ground and one light:

* The film is drawn on glass: `scene.ts` clears the canvas each frame and paints no ground or
  glow. The page's own ground shows through: the page stock by day, Ink by night
  ([[adr-0064-the-public-home-follows-the-reader-s-colour-scheme]]).
* The page lamp from `lamp.ts` is the only glow, the cover included.
* The lit column is told by its data's hue alone; there is no wash behind it.

## Evidence

With the pointer off the page, 12px either side of the cover's bottom edge in the same column,
the dark scheme gave (31, 27, 15) above and (22, 21, 15) below before the change. After it, all
six samples read (22, 21, 15) in dark and (247, 243, 231) in light.

## Rejected

Fading the canvas glow out before its edge (it hides the seam only while the glow is away from
the edge, and leaves two lights that disagree), and stretching the canvas over the whole page (a
full-page canvas every frame to draw a background CSS already draws).

## Consequences

The vault's lamp still decides what it lights (ribs, data, proof slip). A glow appears only
where a pointer actually is.

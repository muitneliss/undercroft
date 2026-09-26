---
title: ADR 0065 The Lamp Lights the Whole Public Home
type: source
date: 2026-09-26
tags: []
source: docs/adr/0065-the-lamp-lights-the-whole-public-home.md
source_path: docs/adr/0065-the-lamp-lights-the-whole-public-home.md
source_hash: b167927e26e6253139017deb3d6726ebf35b31c4a67245f010ef110047e791c0
ingested: 2026-09-26
---

# ADR 0065 The Lamp Lights the Whole Public Home

# ADR 0065 The Lamp Lights the Whole Public Home

## Decision

Supersedes, for the pointer's light only, the line of
[[adr-0063-the-public-cover-moves-continuously]]'s boundary that kept the sheet below the cover
stepped. Nothing on the sheet moves; only its light does.
[[adr-0064-the-public-home-follows-the-reader-s-colour-scheme]] stands.

`@/lib/vault/lamp.ts` follows the pointer over `.landing` and writes `--lamp-x`, `--lamp-y` and
`--lamp-strength`. `landing-cover.css` draws a warm core and a wide Chrome wash from them on a
layer under every section. The cover's film paints its own ground over that layer and draws its
own lamp, so there is one light, not two.

* Follows at the cover lamp's rate, so the two read as one light across the cover's edge. It
  fades in place when the pointer leaves and lights where the pointer first appears.
* The loop runs only while the light moves or fades.
* Reduced motion: the light jumps to the pointer and does not glide.
* Per scheme: a softer core on paper, where Chrome reads as a stain, and a slightly wider wash.
* No React state: three custom properties on the page element, read only by the stylesheet.

## Rejected

Extending the vault's canvas down the page (a full-page canvas every frame, and lit stone
competing with the text to be read), and moving the sheet itself (tilt, parallax, hover lift).

## Consequences

`lamp.test.ts` pins the motion: it follows without overshooting, snaps under reduced motion,
fades and returns, and reports when it has settled so the loop can stop.

---
title: ADR 0066 One Ground, One Light and One Vault for the Public Home
type: source
date: 2026-09-26
tags: []
source: docs/adr/0066-one-ground-and-one-light-for-the-public-home.md
source_path: docs/adr/0066-one-ground-and-one-light-for-the-public-home.md
source_hash: c48bf07902947ebb00cf1499faf7b9464f2bb0c4fed2fe9de2c8f85abf6ba917
ingested: 2026-09-26
---

# ADR 0066 One Ground, One Light and One Vault for the Public Home

# ADR 0066 One Ground, One Light and One Vault for the Public Home

## Decision

Supersedes two parts of [[adr-0065-the-lamp-lights-the-whole-public-home]]: that the cover's
film paints its own ground and lamp, and the rejection of extending the vault's canvas down the
page. The home has one ground, one light and one vault:

* **The vault is fixed to the viewport under every section** (`.landing__vault`,
  `position: fixed; inset: 0`), so its arches run the whole length of the page as it scrolls
  over them. The canvas is viewport-sized, not page-sized. The band and the reader's track are
  measured against it every frame, or on scroll under reduced motion.
* **The film is drawn on glass:** `scene.ts` clears the canvas and paints no ground or glow;
  the page's own ground shows through ([[adr-0064-the-public-home-follows-the-reader-s-colour-scheme]]).
* **The page lamp (`lamp.ts`) is the only glow;** there is no wash behind the lit column.
* **The vault's lamp keeps the lines lit anywhere.** `vaultAim` decides: the hand; else the
  reader while the band is in view; else wandering the viewport. Pinned in `lamp.test.ts`.

## Evidence

Before, with the pointer off the page and 12px either side of the cover's edge in the same
column, the dark scheme gave (31, 27, 15) above and (22, 21, 15) below. After, all six samples
read (22, 21, 15) in dark and (247, 243, 231) in light.

## Rejected

Fading the cover glow out before its edge (it leaves two lights), a canvas as tall as the page
(repaints the full height every frame), and scrolling or walking the vault on scroll (nothing
reacts to scroll position, ADR 0014).

## Consequences

`VaultElements` takes the page, not the cover. The pointer is tracked over the whole home, and
pressing the flow is still a run only inside the band.

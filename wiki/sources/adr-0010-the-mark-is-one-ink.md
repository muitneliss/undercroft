---
title: ADR 0010 The Mark Is One Ink
type: source
date: 2026-09-18
tags: []
source: docs/adr/0010-the-mark-is-one-ink.md
source_path: docs/adr/0010-the-mark-is-one-ink.md
source_hash: 4d9b42bf7e3316ae21e2363e247711c9dea9136489014adf85b5edd51bc24104
ingested: 2026-09-18
---

# ADR 0010 The Mark Is One Ink

> **Numbering note.** Two accepted ADRs share the number 0010. This is the identity one;
> the other is [[ADR 0010 Invite-Only Sign-In with Better Auth]].

## Decision

Undercroft's mark is a **device**: a cut block of board, 32 units square, with a
round-headed arch of three orders cut clean through it. It is authored geometry on the same
grid as the interface's icons, at exactly twice their 16-unit scale, and lives in one place
— `apps/ui/src/components/Mark.tsx` — from which the favicon, `mark.svg` and the two
rasterised icons take the same path data.

**The mark carries no colour of its own.** The component fills in `currentColor` and the
arch is a hole rather than a pale shape, so the only colour that reaches it is whatever is
already behind it. The wordmark is Archivo at `wdth 78`, 700, uppercase.

It ships in three places: the running head on every signed-in division, the imprint on the
title page, and the browser's icon slots.

## Why

* **The word is a preposition, so the silhouette has to be one.** An *undercroft* is the
  vaulted chamber **beneath** a building. An earlier cut drew an arch standing under a heavy
  rule; it read as a bar floating over a shape, and at 16px as a hat. Drawing the mass as a
  block and the vault as a void through it makes "under" the one thing the silhouette cannot
  fail to say — and it is literally how a printer's device is made.
* **Three orders carry the architecture, not decoration.** The three steps are the product's
  three layers in the README's order: the outer cut is what a customer reads, the ring is
  the projection in Postgres, the core is raw. Cut the core out and there is no arch. That
  is [[ADR 0001 Raw Lake Is the Only Durable Layer]] drawn.
* **One ink is what keeps the wheel meaning something.** Seven hues divide the book and
  vermilion is held out so an erratum can be the only thing wearing it. A mark with a colour
  of its own would either claim one of the seven — making the whole identity look like one
  division — or demand an eighth.
* **A hole must show what is behind it.** Cutting the arch through rather than painting it
  pale keeps the mark part of the page instead of a sticker on it.
* **The favicon is the one place the hole is closed.** Browser chrome is not ours, so the
  tile is painted opaque and flips both inks on `prefers-color-scheme`.

## Rejected

* **A three-bay arcade.** Truer to what an undercroft is, but at favicon size the piers fell
  to a single pixel and the bays closed up. A mark that only works above 48px is not a mark.
* **A hue for the mark**, most obviously chrome yellow. Fine in isolation, wrong in the
  product: on the Raw lake division it would be the only thing disagreeing with its section.
* **A wordmark alone.** Already the running head, and it gives the browser tab nothing.
* **Rendering the wordmark to paths for a standalone lockup SVG.** A traced wordmark is a
  second copy of the logotype that silently stops matching the face when the face is updated.

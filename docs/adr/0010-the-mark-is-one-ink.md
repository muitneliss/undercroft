# 10. The mark is an inked block with the arch cut through it, in one ink

- Status: Accepted
- Date: 2026-09-18

## Decision

Undercroft's mark is a **device**: a cut block of board, 32 units square, with a
round-headed arch of three orders cut clean through it. It is authored geometry on the
same grid as the interface's icons (`apps/ui/src/components/Icon.tsx`), at exactly twice
their 16-unit scale, and it lives in one place — `apps/ui/src/components/Mark.tsx` — from
which `apps/ui/public/favicon.svg`, `apps/ui/public/mark.svg` and the two rasterised icons
take the same path data.

**The mark carries no colour of its own.** The component fills in `currentColor` and the
arch is a hole, not a pale shape, so the only colour that ever reaches it is whatever is
already behind it — page stock in the running head, leaf stock on the title page, a section
board's hue anywhere it is set on one. The wordmark is Archivo at `wdth 78`, 700, uppercase:
the running head's existing voice, not a new one.

It ships in three places: the running head on every signed-in division, the imprint on the
title page, and the browser's icon slots.

## Why

- **The word is a preposition, so the silhouette has to be one.** An _undercroft_ is the
  vaulted chamber **beneath** a building. The first cut of this drew an arch standing under
  a heavy rule, the rule standing in for the floor above; it read as a bar floating over a
  shape, and at 16px as a hat. Drawing the mass as a block and the vault as a void through
  it makes "under" the one thing the silhouette cannot fail to say, and it is also literally
  how a printer's device is made — the mark is what is left of the block after the cutting.

- **Three orders carry the architecture, not decoration.** A Romanesque portal is cut in
  concentric archivolts stepping back into the wall. Here the three steps are the product's
  three layers in the README's own order: the outer cut is what a customer reads, the ring
  is the projection in Postgres, the core is raw. Drop the outer orders and the arch still
  stands; cut the core out and there is no arch. That is ADR 0001 drawn.

- **One ink is what keeps the wheel meaning something.** Seven hues divide the book and
  vermilion is held out of the wheel so an erratum can be the only thing wearing it
  (`.claude/rules/money.md`, `apps/ui/src/lib/divisions.ts`). A mark with a colour of its own
  would either claim one of the seven — making the whole identity look like one division —
  or demand an eighth, and the wheel is only legible because nothing outside it spends its
  hues.

- **A hole must show what is behind it.** `index.css` already decided this for the punch on
  a hinged leaf, after two punches painted in a fixed tone read as smudges rather than holes.
  Cutting the arch through the block rather than painting it pale keeps the mark part of the
  page instead of a sticker on it: the arch fills with page stock in the running head, leaf
  stock on the title page, and a section board's hue anywhere the mark is set on one.

- **The favicon is the one place the hole is closed.** Browser chrome is not ours, and a
  transparent arch there fills with whatever tone the tab strip happens to be. So the tile is
  painted opaque and flips both inks on `prefers-color-scheme`: an inked block against a
  light tab strip, a bone block against a dark one. Same block, same cutting, opposite ink.

## Rejected

- **A three-bay arcade.** Truer to what an undercroft actually is, and it says "many" in a
  way a single portal does not. At favicon size the piers fell to a single pixel and the
  bays closed up. A mark that only works above 48px is not a mark.

- **A hue for the mark, most obviously chrome yellow** (the default board and the primary
  plate). It looks fine in isolation and wrong in the product: on the Raw lake division a
  chrome-yellow device is the only thing on screen disagreeing with the section it sits in.

- **A wordmark alone.** "Undercroft" set in Archivo condensed caps is already the running
  head, and already good. It gives the browser tab nothing, which is exactly where a product
  whose operators keep several member companies open at once needs to be recognisable.

- **Rendering the wordmark to paths for a standalone lockup SVG.** The lockup exists only
  where Archivo is loaded, which is the app. Outside it, `mark.svg` plus the name set in the
  host's own type is honest; a traced wordmark is a second copy of the logotype that silently
  stops matching the face when the face is updated.

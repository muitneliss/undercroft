# 65. The lamp lights the whole public home

- Status: Accepted
- Date: 2026-09-26
- Supersedes: for the pointer's light only, the line of
  [ADR 0063](0063-the-public-cover-moves-continuously.md)'s boundary that keeps "the paper sheet
  below the cover" stepped. Nothing on the sheet moves; only its light does. The rest of
  ADR 0063, and [ADR 0064](0064-the-public-home-follows-the-readers-colour-scheme.md), stand.

## Context

The cover's film treats the pointer as a lamp, and it is the only light there. Outside the
cover, on the header and on the sections below it, the page did not answer the pointer at all.
Moving the pointer out of the cover switched the light off, which broke the page's one idea
at its edge. The request was for the rest of the page to answer the pointer too.

## Decision

The lamp lights the whole public home. `@/lib/vault/lamp.ts` follows the pointer over
`.landing` and writes `--lamp-x`, `--lamp-y` and `--lamp-strength`. `landing-cover.css` draws a
warm core and a wide wash of the lamp's colour from those values, on a layer under every
section. The cover's film paints its own ground over that layer and draws its own lamp, so
there is one light, not two.

- **It follows as the cover's lamp does**, at the same rate, so the two read as one light when
  the pointer crosses the cover's edge. It fades where it stands when the pointer leaves, and
  lights where the pointer first appears rather than sweeping in from a corner.
- **It runs only while it moves.** The loop stops once the light has settled on the pointer
  or has faded out.
- **Reduced motion:** the light jumps to the pointer and does not glide. As on the cover, the
  lamp still answers the hand; nothing travels.
- **Both schemes:** the core is softer on the paper stock than on Ink, where the same share of
  Chrome reads as a stain, and the wash a little wider, so the light still reads on paper.
- **No React state.** Three custom properties on the page element are the whole interface,
  and only the stylesheet reads them (`state.md`).

## What this rejects

- **Extending the vault's canvas down the page.** It would paint a full-page, two-pixel-ratio
  canvas every frame for stone the sheet does not need. The sheet is text to be read, and a
  lit vault behind it would compete with the text.
- **Moving the sheet itself** (tilt, parallax, hover lift). The sheet is reading matter.
  Light may move across it; the text stays still.

## Consequences

`lamp.test.ts` pins the light's motion: it follows without passing the pointer, snaps under
reduced motion, fades and returns, and reports when it has settled so the loop can stop.

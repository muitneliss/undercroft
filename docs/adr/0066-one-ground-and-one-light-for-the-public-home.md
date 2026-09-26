# 66. One ground and one light for the public home

- Status: Accepted
- Date: 2026-09-26
- Supersedes: [ADR 0065](0065-the-lamp-lights-the-whole-public-home.md)'s sentence "the cover's
  film paints its own ground over that layer and draws its own lamp". The rest of ADR 0065,
  and ADRs 0063 and 0064, stand.

## Context

The cover's canvas painted its own ground and its own warm glow, sized to the cover, while the
page below it was the plain ground. The glow stopped hard at the canvas's bottom edge, so the
home read as two backgrounds. Measured with the pointer off the page, 12px either side of the
cover's bottom edge in the same column, the dark scheme gave (31, 27, 15) above and
(22, 21, 15) below, an edge visible under the principle line. The faint wash behind the lit
column was a second ground with its own edges.

## Decision

The home has one ground and one light.

- The film is drawn on glass. `scene.ts` clears the canvas each frame and paints no ground and
  no glow. The page's own ground shows through: the book's page stock by day and Ink by night
  (ADR 0064).
- The page lamp from `lamp.ts` is the only glow, the cover included. It sits under every
  section, and nothing above it paints a ground that would cut it off.
- The lit column is told by its data's hue alone. There is no wash behind it.

After the change the same six samples read (22, 21, 15) in dark and (247, 243, 231) in light,
on both sides of the edge.

## What this rejects

- **Fading the canvas's glow out before its edge.** That hides the seam only while the glow
  stays away from the edge, and it still leaves two lights that disagree about where the
  lamp is.
- **Stretching the canvas over the whole page** so its edge is the page's edge. That means a
  full-page canvas painted every frame to draw a background CSS already draws.

## Consequences

The vault's lamp still decides what it lights (the ribs, the data, the proof slip), and when
the reader walks by itself it lights them without a glow. A glow appears only where a pointer
actually is.

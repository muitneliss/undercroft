# 66. One ground, one light and one vault for the public home

- Status: Accepted
- Date: 2026-09-26
- Supersedes: two parts of [ADR 0065](0065-the-lamp-lights-the-whole-public-home.md): the
  sentence "the cover's film paints its own ground over that layer and draws its own lamp",
  and its rejection of "extending the vault's canvas down the page". The rest of ADR 0065,
  and ADRs 0063 and 0064, stand.

## Context

Two things split the home into a top and a bottom.

- **Two backgrounds.** The cover's canvas painted its own ground and a warm glow sized to the
  cover, while the page below it was the plain ground. The glow stopped hard at the canvas's
  bottom edge. With the pointer off the page, 12px either side of that edge in the same column,
  the dark scheme measured (31, 27, 15) above and (22, 21, 15) below. The faint wash behind
  the lit column was a second ground with edges of its own.
- **The vault stopped with the cover.** Its arches ended at the cover's bottom edge, and the
  request was for the lines to go through the whole page.

ADR 0065 rejected extending the canvas down the page for two reasons: a full-page canvas
painted every frame costs too much, and lit stone would compete with the text. The first
applies to a canvas as tall as the page. It does not apply to one the size of the viewport. The
second is answered by the lamp: the lines are faint except where the pointer holds the light.

## Decision

The home has one ground, one light and one vault.

- **The vault is fixed to the viewport under every section.** `.landing__vault` is
  `position: fixed; inset: 0` at the back of the page, so its arches stay in view the whole
  length of the page as it scrolls over them. The canvas is the viewport's size, not the
  page's. The film measures the band and the reader's track against it every frame, and on
  scroll under reduced motion, so the data path is still drawn exactly where its band is.
- **The film is drawn on glass.** `scene.ts` clears the canvas each frame and paints no ground
  and no glow. The page's own ground shows through: the page stock by day, Ink by night.
- **The page lamp from `lamp.ts` is the only glow.** The lit column is told by its data's hue
  alone, with no wash behind it.
- **The vault's lamp keeps the lines lit anywhere.** It goes to the hand; else along the track
  with the reader while the band is in view; else it wanders the viewport. `vaultAim` in
  `lamp.ts` decides, and `lamp.test.ts` pins each case.

After the change, the same six samples read (22, 21, 15) in dark and (247, 243, 231) in
light, on both sides of the old edge.

## What this rejects

- **Fading the cover's glow out before its edge.** That hides the seam only while the glow
  stays away from the edge, and it leaves two lights that disagree.
- **A canvas as tall as the page.** It would repaint the whole page's height every frame; a
  fixed viewport canvas draws only what can be seen.
- **Scrolling the vault with the page, or walking it on scroll.** Nothing reacts to scroll
  position (ADR 0014). The vault stands still and the page passes over it.

## Consequences

`VaultElements` takes the page, not the cover. The pointer is tracked over the whole home, and
pressing the flow is still a run only inside the band.

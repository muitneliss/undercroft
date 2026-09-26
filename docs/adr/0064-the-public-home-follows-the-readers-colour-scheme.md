# 64. The public home follows the reader's colour scheme

- Status: Accepted
- Date: 2026-09-26
- Supersedes: one consequence of
  [ADR 0063](0063-the-public-cover-moves-continuously.md): "The cover is dark". The rest of
  ADR 0063 stands, the continuous motion and its boundary included.

## Context

ADR 0063 put the cover on Ink and left the sections below it on the paper stock. On a dark
system the page broke in half: a dark cover over a white sheet. The request was to make the
background adapt. The option chosen was to follow the reader's own light or dark setting,
rather than making the whole home dark for everyone.

## Decision

The public home at `/` follows `prefers-color-scheme`, for the whole page, and changes live
when the reader switches:

- **Light:** the book as printed. The page stock and the book's own tokens run from the header
  to the footer, the cover included. The vault is drawn in Ink on the Page stock, and the
  wheel's hues are used at their own values.
- **Dark:** the book inverted, for the whole page and not only the cover. Every child of
  `.landing` remaps the book's tokens (Ink becomes Bone, Leaf becomes the Ink ground), so
  plates, links, focus rings and the language pair invert by the rules they already follow.
- **One painter, two palettes.** `@/lib/vault/frame.ts` holds `NIGHT` and `DAY`, and the film
  chooses by `(prefers-color-scheme: dark)`. `frame.test.ts` holds both to WCAG 2.1 on their
  own ground: 4.5:1 for everything that letters text (the data's ink, the lamp's accent, the
  sources' tone) and 3:1 for every lit column.
- **The lamp's colour** is Chrome at night. By day it is Chrome mixed 55% toward Ink, because
  Chrome on the page stock would letter the headline at 1.9:1.

## What this rejects

- **Dark for everyone.** It keeps the cover's drama, but it ignores a reader who asked for
  light, and it does not match the paper book they meet after signing in.
- **A theme switch on the page.** The reader's system already states the preference.
  Storing a second copy of it would be client state with two owners (`state.md`).
- **Extending the scheme to the app.** Behind sign-in is the book; its colour scheme is a
  separate decision, and nothing here changes it.

## Consequences

- A new colour on the cover has to be added to both palettes, and the contrast test fails
  until it holds on both grounds.
- `landing-cover.css` owns the token remap, behind `prefers-color-scheme: dark`, and
  `--lamp-ink` is the one colour that differs between the two schemes' lettering.

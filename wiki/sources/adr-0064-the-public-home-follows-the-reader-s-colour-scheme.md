---
title: ADR 0064 The Public Home Follows the Reader's Colour Scheme
type: source
date: 2026-09-26
tags: []
source: docs/adr/0064-the-public-home-follows-the-readers-colour-scheme.md
source_path: docs/adr/0064-the-public-home-follows-the-readers-colour-scheme.md
source_hash: b04f9ab850deaa095598e553f54724cad8da8a1a02e56f39a8fe7b33e864f244
ingested: 2026-09-26
---

# ADR 0064 The Public Home Follows the Reader's Colour Scheme

# ADR 0064 The Public Home Follows the Reader's Colour Scheme

## Decision

Supersedes one consequence of [[adr-0063-the-public-cover-moves-continuously]] ("the cover is
dark"). The public home at `/` follows `prefers-color-scheme` for the whole page, and changes
live when the reader switches.

* **Light:** the book as printed. Page stock and the book's tokens from header to footer; the
  vault is drawn in Ink on Page, and the wheel hues are used at their own values.
* **Dark:** the book inverted, for the whole page. Every child of `.landing` remaps the
  book's tokens (Ink→Bone, Leaf→Ink ground), so controls invert by their existing rules.
* **One painter, two palettes:** `NIGHT` and `DAY` in `@/lib/vault/frame.ts`, chosen by
  `(prefers-color-scheme: dark)`. `frame.test.ts` holds both to WCAG 2.1 on their own ground:
  4.5:1 for anything that letters text, 3:1 for every lit column.
* **Lamp colour** (`--lamp-ink`) is Chrome at night and Chrome mixed 55% toward Ink by day,
  because Chrome on Page would letter the headline at 1.9:1.

## Rejected

Dark for everyone (it overrides the reader's stated preference and does not match the paper
app behind sign-in), an on-page theme switch (a second owner of a preference the system
already holds), and extending the scheme into the app.

## Consequences

A new cover colour must be added to both palettes, and the contrast test fails until it holds
on both. `landing-cover.css` owns the token remap behind the dark-scheme query.

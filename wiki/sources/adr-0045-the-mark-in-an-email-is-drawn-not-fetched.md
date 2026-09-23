---
title: 'ADR 0045: The mark in an email is drawn, not fetched'
type: source
date: 2026-09-23
tags: []
source: docs/adr/0045-the-mark-in-an-email-is-drawn-not-fetched.md
source_path: docs/adr/0045-the-mark-in-an-email-is-drawn-not-fetched.md
source_hash: 46baaa243020a08a52e6d255a74debaa96658ff7d163058caf958ac044f295ee
ingested: 2026-09-23
---

# ADR 0045: The mark in an email is drawn, not fetched

# 45. The mark in an email is drawn, not fetched

* Status: Accepted
* Date: 2026-09-23
* Extends: [[ADR 0030: An email is a leaf of the book, posted]] (nothing in an email calls
  home) and [[ADR 0010 The Mark Is One Ink]] (the device, now set in a fourth place)

## Decision

Every email's running head carries the Undercroft mark before the wordmark. It is written into
the markup as an inline `<svg>` with the mark's own path, in one ink (`#16150f`), with the arch
cut through under `evenodd` so the page stock shows inside it. It is `aria-hidden` and has no
`<title>`. Gmail and Outlook's Word engine strip inline SVG, so readers there get the wordmark
alone, as before. That is the accepted cost.

## Why

ADR 0030's "no image" rule was about the network: a fetched picture reveals when and where a
sign-in code was opened. An inline SVG fetches nothing, and the `self-containment` tests in
`emailTemplate.test.ts` still pass over a leaf that carries it. The `<svg>` holds its own
spacing and has no text child, so a client that strips it leaves nothing behind. It has no
`xmlns`, because that would be the only absolute URL in the markup that the leaf was not given.

## Rejected

* A hosted PNG: it calls home, and Outlook blocks it by default.
* A CID inline attachment: it shows everywhere, but it needs attachments on `EmailMessage` and
  the Resend payload, and it appears as a paperclip in some clients.
* The mark drawn as table cells: about 15KB per message against Gmail's 102KB clip, and the
  arch's curves come out stair-stepped.

## Consequences

The path lives in four places: `Mark.tsx`, `public/mark.svg`, `public/favicon.svg` and
`emailTemplate.ts`, because core cannot import the UI. `Mark.tsx`'s docstring lists them. The
plain-text branch is unchanged, because the mark carries no words.

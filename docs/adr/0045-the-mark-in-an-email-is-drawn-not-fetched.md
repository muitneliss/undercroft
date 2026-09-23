# 45. The mark in an email is drawn, not fetched

- Status: Accepted
- Date: 2026-09-23
- Extends: [ADR 0030](0030-an-email-is-a-leaf-of-the-book-posted.md), whose "nothing in an email
  calls home" this keeps, and [ADR 0010](0010-the-mark-is-one-ink.md), whose device this sets in
  a fourth place: the running head of every email.

## Decision

Every email's running head carries the Undercroft mark before the wordmark, the same way the
interface's running head does. It is written into the markup as an inline `<svg>` with the
mark's own path, in one ink (`#16150f`), with the arch cut through under `evenodd` so the page
stock shows inside it. It is `aria-hidden` and has no `<title>`.

Gmail and Outlook's Word engine strip inline SVG. Readers there get the running head as it was
before this ADR: the wordmark alone. That is the accepted cost.

## Why

ADR 0030 wrote "no image", and the reason it gave was about the network: a fetched picture tells
a third party that a sign-in code was opened, when, and from which IP. An inline SVG fetches
nothing. It arrives inside the message, so the reason for the rule does not apply to it, and
the `self-containment` tests in `emailTemplate.test.ts` still pass unchanged over a leaf that
carries the mark.

The mark is built so that stripping it costs nothing. The `<svg>` carries its own margin and
alignment, so when a client removes it no gap or empty cell is left behind. It has no text
child, so a client that strips the tags and keeps their text prints nothing. It also has no
`xmlns`, because HTML parses inline SVG without one, and the namespace would be the only
absolute URL in the markup that the leaf was not given.

## Options rejected

- **A hosted PNG.** It would show in every client, but it is exactly what ADR 0030 exists to
  refuse, and Outlook blocks remote images by default in any case.
- **A PNG sent as a CID inline attachment.** It would show in Gmail and Outlook with nothing
  fetched. It also needs an attachments field on `EmailMessage` and in the Resend payload, and
  some clients list the mark as a paperclip attachment on a sign-in code. That is too much
  surface for a letterhead.
- **The mark drawn as a grid of table cells.** It would show everywhere with nothing fetched. It
  costs about 15KB of markup per message, which counts against the 102KB at which Gmail clips a
  message, and the three orders of the arch come out stair-stepped at one pixel per unit. That
  is a pixel icon, not the cut device ADR 0010 describes.

## Consequences

- The path now lives in four places: `Mark.tsx`, `public/mark.svg`, `public/favicon.svg` and
  `emailTemplate.ts`, because `@undercroft/core` cannot import the UI. `Mark.tsx`'s docstring
  lists all four, and a change to the geometry has to be made in each.
- The plain-text branch is unchanged. The mark carries no words, so the rule that both branches
  say the same thing has nothing to compare.

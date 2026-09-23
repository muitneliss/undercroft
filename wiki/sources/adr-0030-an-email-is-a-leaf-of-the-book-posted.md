---
title: 'ADR 0030: An email is a leaf of the book, posted'
type: source
date: 2026-09-21
tags: []
source: docs/adr/0030-an-email-is-a-leaf-of-the-book-posted.md
source_path: docs/adr/0030-an-email-is-a-leaf-of-the-book-posted.md
source_hash: 87fbf2014fbbe6b5f9609e7720aefc5087d86eb169db7d180c7c13d183c1654c
ingested: 2026-09-21
---

# ADR 0030: An email is a leaf of the book, posted

# 30. An email is a leaf of the book, posted

* Status: Accepted
* Date: 2026-09-21
* Supersedes: the "one thing this platform emails / three fields and not a templating system"
  reasoning in the docstring of `packages/core/src/email.ts`
* Extends: [[ADR 0012 Vietnamese First, i18next in Browser and Server]]

## Decision

Undercroft's five emails — the sign-in code, the invitation, a failed run, a lapsing grant, a
lapsing ingest key — are **set** in the visual world `apps/ui/DESIGN.md` describes: warm page
stock on a bone board, a running head naming whose book is open, a ruled schedule of facts
with its heads in the margin, a die-cut chrome plate for the single next action, and — for a
run that failed — the errata slip, the only object in the system allowed vermilion.

Three things carry it:

1. **`EmailMessage` gains an optional `html`; `text` stays required.** The plain-text branch
   is the message; the markup is the same message set.
2. **One document, two renderings.** `renderEmailLeaf` in `packages/core/src/emailTemplate.ts`
   takes a structured `EmailLeaf` — six block kinds: prose, schedule, token, errata, plate,
   note — and returns both branches from it.
3. **Nothing in an email calls home.** No image, no remote font, no tracking pixel.

## Why the old decision expired rather than was wrong

`email.ts` argued for three fields on an explicit condition: "the day a second kind of message
exists is the day to grow it". There was one message; there are now five, three of them alerts
carrying a source, a timestamp, a reason and a link. The condition it named has been met, so
this is the growth it authorised. It is still not a mail framework: one leaf shape, six block
kinds, and a message is a list of them.

## Why one document rather than two catalogues

An `html` key beside every `body` key fails invisibly: somebody corrects a sentence in the
markup, nobody opens the text, and the readers who get the text branch — plain-text clients,
screen readers set to prefer it, every quoted reply — are told something the sender stopped
believing. Rendering both from one description makes that unrepresentable, and the suite
compares the branches literally, phrase by phrase. Same reasoning as "one writer, many
callers", applied to words instead of bytes.

This is why caps are applied in code rather than by `text-transform`: with the transform in
CSS the markup said SOURCE while the text said Source, and a parity test forced to compare
case-insensitively is one that has stopped noticing real edits.

## Why nothing may call home

A web font would give the emails their real faces and would tell a third party the moment a
sign-in code was opened, from which IP. For a platform whose mail is mostly credentials and
security notices that is worse than an email set in Georgia. The same argument bans a spacer
image and a tracking pixel, so there is no open-rate metric.

The cost, stated plainly: Archivo, EB Garamond and Spline Sans Mono will not load in most mail
clients. The stacks name them first; everyone else gets Helvetica, Georgia and a platform
mono. Structure, palette, rules and spacing carry the identity instead of the lettering.

## Why the errata slip is only on a failure

The Vermilion Rule holds vermilion out of the wheel so the correction slip is the only thing
wearing it. A failed run gets the slip because it IS a correction; a grant or key about to
lapse has not lapsed, so its date is set in Pending umber — the interface's own pending tone.
Pinned from both sides: an errata block wears vermilion, a leaf without one carries none.

## Why escaping moved into the renderer

`i18n/index.ts` runs i18next with `escapeValue: false` and must keep doing so — its output
feeds the plain-text branch and HTTP refusals, where an escaped apostrophe in a customer's
name is a defect. So the markup branch escapes each value as it writes it. An ingest key's
label and a run's error message are written outside this repo and land in an administrator's
inbox.

## Options rejected

* **Plain text, better copy only.** Leaves an alert a wall of prose where the source, the time
  and the reason carry equal weight — the job a ruled schedule does better.
* **Markup for the notices, plain text for the code.** The original objection was to HTML as
  decoration; a code set large in a keylined box is better at the one job the message has.
* **MJML or react-email.** A build step, a dependency tree and a second component vocabulary
  that knows nothing about plates, leaves or the Vermilion Rule — and it renders only the
  markup branch, handing back the drift this ADR removes.
* **A dark-mode variant.** One stock, warm bone; printed matter is not dark. The template
  declares `color-scheme: light` and carries explicit `bgcolor` for clients that force it.

## Consequences

* `task dev:email-preview` renders all five, both languages, from the real composers, to the
  gitignored `data/email-preview/` — so a preview cannot drift from what is sent.
* The sign-in code's composition left the Better Auth hook for an exported `signInCodeMessage`,
  matching the four that were already pure values.
* The catalogue's email entries are one key per sentence and per label rather than five
  sentences joined into one `body`, which is what the i18n rule asked for already.
* The leaf is fluid with a `max-width`, plus an Outlook-only conditional for the Word engine
  that ignores it. A fixed width renders identically on a desktop and clips on every phone.
* A new message is a list of existing blocks; a new **block** is a case in two switches that
  both fail to compile until it is answered in both branches.

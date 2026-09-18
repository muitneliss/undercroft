---
title: ADR 0014 Frames Are Size, Nothing Eases
type: source
date: 2026-09-18
tags: []
source: docs/adr/0014-frames-are-size-motion-is-stepped.md
source_path: docs/adr/0014-frames-are-size-motion-is-stepped.md
source_hash: 5a22d1baf72ee360591c04a9081324639153239efa922eb3f27169eeb4e051d6
ingested: 2026-09-18
---

# ADR 0014 Frames Are Size, Nothing Eases

## Decision

The control-plane UI has **four motion tokens instead of one**, and the frame count in a
token is **the size of the thing that moved**:

| Token     | Value                 | What moves                                             |
| --------- | --------------------- | ------------------------------------------------------ |
| `--hinge` | `90ms steps(2, end)`  | a part: a plate, a punch, an input rule, a tab         |
| `--tip`   | `150ms steps(3, end)` | a loose slip laid onto the page: errata, a status note |
| `--turn`  | `190ms steps(4, end)` | a whole leaf, turning about its spine                  |
| `--pass`  | `120ms steps(2, end)` | nothing. Ink going down in passes of the press         |

Every token is `steps(n, end)`. **There is no `cubic-bezier` anywhere in
`apps/ui/src/index.css`** — this ADR extends the existing no-easing doctrine rather than
relaxing it.

The authored moment is the **page turn**: `.leaf` rotates 5° about `left center` under a
1600px perspective and lands flat in four frames. `Book.tsx` keys the leaf to
`` `${tenantId}/${current}` ``, so it fires when the division changes and when the customer
changes, and does not fire for a panel hinging open inside the section it already belongs
to. The key is load-bearing: React Router reconciles two routes that render the same
component in the same position — every division goes through `Opened` — so without it the
leaf is updated rather than remounted and the animation never runs.

Six supporting states sit at the tier their object belongs to: errata slips and status
notes are **tipped in** crooked and land square (`--tip`); a schedule or table row **inks
in** when it is new (`--pass`); the open tab's selection hole is **punched** in one stroke
(`--hinge`); a struck plate travels 1px down (`--hinge`); the row wash under the cursor
changes in the hinge's two frames instead of cutting; and the sign-in step is keyed so
asking for the code is a slip arriving rather than a form edited in place.

`.book` takes `overflow-x: clip` — a leaf mid-turn is tipped toward the reader and projects
a few per cent wider than the page it lands on.

## Why

* **One token stopped describing one thing.** `--hinge` was introduced for a hinged panel
  and then spent on plates, inputs, punches and the progress rule because it was the only
  token there was. The name had stopped being true and the value had stopped carrying
  information: everything moved at the same rate whether it was a checkbox or a page.
* **Frames can carry meaning for free.** This design already plays that trick — ply is rank,
  shape is state before hue is, lettering is solved per board (see
  [[ADR 0010 The Mark Is One Ink]]). A stepped system has a variable an eased one does not:
  the frame count is directly visible, so a reader who has seen two tiers can size the third
  without being told.
* **The book's defining gesture was the thing it never did.** The whole navigation is a tab
  strip on a ring binder (see [[ADR 0012 The Tab Strip Crosses the Head]]). Opening a
  division replaced the page instantly — what a screen does, not what a book does — so the
  metaphor was carried entirely by static drawing and contradicted the moment anyone used it.
* **Motion was the only channel some states had.** An errata slip carries `role="alert"`, so
  a screen reader is told it arrived; a sighted reader was told nothing, and a slip already
  on the page looked identical to one that appeared while they were reading. The same gap
  sat on the sign-in step change, the one moment that screen exists to communicate.
* **A new row is the signal; a staggered list is not.** Rows reconcile by key, so an existing
  row does not remount and does not re-ink. Withdraw an invitation and the remaining rows sit
  still; send one and exactly one line is laid down.

## Rejected

* **Easing, at every tier.** `cubic-bezier(0.16, 1, 0.3, 1)` is the reflex answer for a
  confident arrival and would have made all seven effects feel like a competent modern web
  app — precisely the failure, since the surface would stop being a printed object the moment
  it moved. Stepping is not a stylisation of easing; it is the claim that this thing is moved
  rather than animated.
* **Motion on scroll.** Nothing reacts to scroll position. This is an Operate surface; the
  reader is reading a schedule of standing authorities, not being walked through a narrative.
* **A motion library.** All seven are CSS keyframes or transitions on `transform` and
  `opacity`. Nothing needed interruption, sequencing or a dynamic value, so nothing needed
  Framer Motion or the Web Animations API.
* **A stagger on lists.** The effect that looks most like craft and destroys the one piece of
  information the row animation actually carries.
* **`overflow-x: hidden` on `.book`.** It computes the other axis to `auto` and would move the
  document's scroll inside `.book`. Where `clip` is unsupported the axis falls back to
  `visible` and a turning leaf can briefly overhang the binder — a 190ms cosmetic overflow.

## Reduced motion

`prefers-reduced-motion: reduce` collapses `--hinge`, `--tip` and `--turn` to a single frame,
switches the leaf turn and the punch off, and swaps the slip's keyframes for the ink pass, so
a slip still lays itself down without arriving from above or landing crooked.

`--pass` is **deliberately untouched**: it is opacity, nothing travels in it, and a row that
inks in is how a reader learns that row is new. Reducing it too would read the preference as
"tell me less" rather than "move me less". Related: [[ADR 0009 UI State in Zustand, useState Banned]]
covers why the leaf's remount key lives in the route rather than in component state.

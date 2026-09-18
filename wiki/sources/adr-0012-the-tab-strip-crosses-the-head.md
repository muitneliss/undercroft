---
title: ADR 0012 The Tab Strip Crosses the Head
type: source
date: 2026-09-18
tags: []
source: docs/adr/0012-tab-strip-at-the-head-not-the-fore-edge.md
source_path: docs/adr/0012-tab-strip-at-the-head-not-the-fore-edge.md
source_hash: 7db0c341ad4587537d2d5131741f3582ab6f2a556a50b31c1238860f86a8e76b
ingested: 2026-09-18
---

# ADR 0012 The Tab Strip Crosses the Head

> **Numbering note.** Two accepted ADRs share the number 0012. This is the navigation one;
> the other is [[ADR 0012 Vietnamese First, i18next in Browser and Server]].

## Decision

The control plane's divisions are **top tabs across the head of the leaf**, set in upright
Archivo caps. They were side tabs down the fore edge, set with `writing-mode: vertical-rl`
in a 3.25rem column.

Everything the fore-edge rail carried survives the move:

* **Extent still sizes the tab**, now as `flex-grow` along the horizontal axis. It remains a
  property of the division rather than a count of the current customer's rows, so the
  navigation does not resize under the cursor.
* **Selection is still the punched hole** — not a colour change and not a bar — so
  `aria-current` has a visible partner that survives greyscale and colour-blindness.
* **A locked division still renders face-down**, with the reason in its accessible name.
* **Lettering is still chosen per hue** by `letteringOn`, so a division added later is
  lettered legibly without anyone remembering to think about it.

The strip is **first in the DOM at every width.** The phone moves it to the foot with
`grid-template-areas`, not with source order, so navigation precedes the page it navigates
for a keyboard and for assistive technology whether drawn above or below.

The face-down lettering moves from `#5f5844` to `#524a37`: 4.37:1 to 5.42:1 on the hatch.

## Why

* **A rotated word has no word shape.** The eye catches a word by its outline before reading
  the letters, and turning it 90° destroys that outline, pushing the reader down to
  letter-by-letter decoding. In greyscale the rail's hue carried more information than its
  label did, which is backwards for navigation.
* **The fore edge caused the rotation.** At 3.25rem the column could not hold `CUSTOMERS`
  upright, so the type had to turn. The placement and the defect were the same decision.
* **This is not a retreat to a category default.** A top tab is the other real tabbed-divider
  form — the exhibit binder, the index-card box — and the one whose lettering was always
  printed upright. The fore-edge thumb index that genuinely rotates its lettering is a
  dictionary's, not a divider's.
* **The phone breakpoint was already this.** The two were a single object described twice,
  tested separately and free to drift; they are now one object hung from a different edge.

## Rejected

* **Widen the fore edge to 9.25rem and letter it upright.** The strongest alternative,
  preserving the most. Rejected on cost — it spends 6rem of page width permanently and
  leaves the head/foot split between desktop and phone in place.
* **Keep the 3.25rem fore edge, letter it upright in condensed caps.** The smallest possible
  change, rejected for having no headroom: `CUSTOMERS` measures 53px in a 55px column, which
  silently attaches a naming constraint to every unclaimed hue.
* **Moving the phone's strip to the head as well.** The foot is where a thumb is, and the
  leaf's own heading should be the first thing on a phone screen.
* **Abbreviating the labels to initials with the word on hover.** Hover is not available to
  touch or keyboard, and navigation reading `C S L P` replaces a legibility problem with a
  memory one.

## Supersedes

Nothing formally — the fore-edge placement lived in docstrings and CSS comments, never in an
ADR. This ADR exists so the fore edge's reasoning, and the reason it stopped holding, are
not lost with the CSS that expressed it.

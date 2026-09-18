# 12. The tab strip crosses the head, not the fore edge

- Status: Accepted
- Date: 2026-09-18

## Decision

The control-plane's divisions are **top tabs across the head of the leaf**, set in upright
Archivo caps. They were side tabs down the fore edge, set with `writing-mode: vertical-rl`
in a 3.25rem column.

Everything the fore-edge rail carried survives the move:

- **Extent still sizes the tab**, now as `flex-grow` along the horizontal axis instead of the
  vertical one. It remains a property of the division rather than a count of the current
  customer's rows, so the navigation does not resize under the cursor.
- **Selection is still the punched hole** — not a colour change and not a bar — so
  `aria-current` has a visible partner that survives greyscale and colour-blindness.
- **A locked division still renders face-down**, the leaf turned over showing unprinted board
  back, with the reason in its accessible name. Nothing vanishes.
- **Lettering is still chosen per hue** by `letteringOn`, so a division added later is
  lettered legibly without anyone remembering to think about it.

The strip is **first in the DOM at every width.** The phone moves it to the foot with
`grid-template-areas`, not with source order, so navigation precedes the page it navigates
for a keyboard and for assistive technology whether it is drawn above or below.

The face-down lettering moves from `#5f5844` to `#524a37`: 4.37:1 to 5.42:1 on the hatch.

## Why

- **A rotated word has no word shape.** The eye catches a word by its outline before it
  reads the letters, and turning it 90° destroys that outline — the reader is pushed down to
  letter-by-letter decoding. Spending that on the one control whose entire job is answering
  _which section is open_ is the wrong trade at any width. It was not a small cost either:
  in greyscale the rail's hue carried more information than its label did, which is backwards
  for navigation.
- **The fore edge caused the rotation.** At 3.25rem the column could not hold `CUSTOMERS`
  upright, so the type had to turn. The placement and the defect were the same decision.
- **This is not a retreat to a category default.** The worry with moving navigation is
  ending up with a dashboard's sidebar or a generic top nav. A top tab is neither: it is the
  other real tabbed-divider form — the exhibit binder, the index-card box — and it is the one
  whose lettering was always printed upright. The fore-edge thumb index, the form that
  genuinely does rotate its lettering, is a dictionary's, not a divider's. The strip is
  therefore _more_ faithful to the source than the rail it replaces, not a concession made
  to legibility.
- **The phone breakpoint was already this.** It had flipped the rail to a horizontal strip
  with upright labels since the first build. The two were a single object described twice,
  tested separately, and free to drift; they are now one object hung from a different edge.

## Rejected

- **Widen the fore edge to 9.25rem and letter it upright** ("the printed divider"). The
  strongest alternative and the one that preserves the most: fore edge, extent-proportional
  heights, punch and face-down all untouched, with the type simply standing up. Rejected on
  cost — it spends 6rem of page width permanently, and it leaves the head/foot split between
  desktop and phone in place rather than closing it.
- **Keep the 3.25rem fore edge, letter it upright in condensed caps** ("the narrow fore
  edge"). The smallest possible change: at width 62, all four labels fit on one line in
  4.5rem. Rejected because it has no headroom — `CUSTOMERS` measures 53px in a 55px column.
  The wheel deliberately holds three unclaimed hues for divisions not yet built, and this
  option silently attaches a naming constraint to every one of them that nothing in the code
  would remind anyone about.
- **Moving the phone's strip to the head as well.** The foot is where a thumb is, and the
  leaf's own heading should be the first thing on a phone screen rather than the navigation.
  That reasoning predates this ADR and survives it; only the lettering and the edge rules
  changed on the phone.
- **Abbreviating the labels to initials with the word on hover.** A thumb index does exactly
  this, and it would have saved the fore edge. Hover is not available to touch or to keyboard,
  and an Operate surface whose navigation reads `C S L P` has replaced a legibility problem
  with a memory one.

## Supersedes

Nothing formally — the fore-edge placement was recorded in the `TabRail` and `Book`
docstrings and in the tab-rail section of `index.css`, never in an ADR. Those comments now
describe the strip and point here. This ADR exists so the fore edge's reasoning, and the
reason it stopped holding, are not lost with the CSS that expressed it.

---
name: Undercroft
description: A control plane printed as a book — tabbed divisions, one leaf open on a section board, corrections tipped in on vermilion slips.
colors:
  bone: "#efe9d9"
  leaf: "#fbf8f0"
  page: "#f7f3e7"
  ink: "#16150f"
  ink-2: "#56513f"
  ink-3: "#6b6450"
  rule: "rgba(22, 21, 15, 0.16)"
  rule-strong: "rgba(22, 21, 15, 0.44)"
  oxide: "#b24b1a"
  chrome: "#eda600"
  grass: "#3e782b"
  teal: "#0f7673"
  ultramarine: "#234c9e"
  violet: "#634cb0"
  sienna: "#7f4023"
  errata: "#cf2f16"
  errata-ink: "#8c1c09"
  errata-ground: "#fdf0eb"
  mark-granted: "#1c5c33"
  mark-pending: "#6b4a00"
typography:
  display:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.5rem"
    fontWeight: 700
    lineHeight: 1.05
    fontVariation: "'wdth' 88"
  headline:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    fontVariation: "'wdth' 88"
  title:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    letterSpacing: "-0.005em"
    fontVariation: "'wdth' 88"
  body:
    fontFamily: "EB Garamond, ui-serif, Georgia, serif"
    fontSize: "1.0625rem"
    lineHeight: 1.53
  lead:
    fontFamily: "EB Garamond, ui-serif, Georgia, serif"
    fontSize: "1.125rem"
    lineHeight: 1.45
  label:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 700
    letterSpacing: "0.15em"
    fontVariation: "'wdth' 82"
  datum:
    fontFamily: "Spline Sans Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.8125rem"
    fontFeature: "tabular-nums"
rounded:
  plate: "2px"
  leaf: "3px"
spacing:
  s1: "0.25rem"
  s2: "0.5rem"
  s3: "0.75rem"
  s4: "1rem"
  s5: "1.5rem"
  s6: "2rem"
  s7: "3rem"
  s8: "4.5rem"
components:
  plate:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.plate}"
    padding: "0.5rem 0.9rem"
  plate-hover:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.leaf}"
  plate-primary:
    backgroundColor: "{colors.chrome}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.plate}"
    padding: "0.5rem 0.9rem"
  plate-primary-hover:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.chrome}"
  plate-small:
    padding: "0.3rem 0.6rem"
  input:
    backgroundColor: "{colors.leaf}"
    textColor: "{colors.ink}"
    typography: "{typography.datum}"
    rounded: "{rounded.plate}"
    padding: "0.5rem 0.65rem"
  errata:
    backgroundColor: "{colors.errata-ground}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    padding: "1rem 1.5rem"
  hinge:
    backgroundColor: "{colors.chrome}"
    rounded: "{rounded.leaf}"
    padding: "1.5rem 1.5rem 1.5rem 3rem"
  unprinted:
    backgroundColor: "{colors.leaf}"
    rounded: "{rounded.leaf}"
    padding: "2rem 1.5rem"
  token:
    backgroundColor: "{colors.leaf}"
    textColor: "{colors.ink}"
    rounded: "{rounded.plate}"
    padding: "1rem"
---

# Design System: Undercroft

## Overview

**Creative North Star: "The Undercroft"**

Printed, exact, unhurried, warm. The vaulted chamber beneath a building holds everything up
and outlives what stands on it, and the interface is built the way such a place is used: a
reference book of customer cases kept on a desk, with divisions cut as tabs across the head,
one leaf lying open on a section board, and a running head naming whose book is open. Nothing
here is a screen pretending to be paper; it is printed matter that happens to be read on a
screen, so the ground is warm bone, the rules are hairlines, the type is set in caps and
Garamond, and a control is a die-cut plate rather than a button.

Density is that of a working schedule, not a marketing page. The operator is usually mid-call
about one customer and reads down a column of sources the way they read any ledger, so every
state gets the height it deserves: a granted source is one line, a source awaiting its scope
is half-hinged off its binding edge, a lapsed grant tips in a correction slip. Motion is the
movement of printed leaves — stepped, never eased — and the number of frames says what size of
thing just moved. The one exception is the public cover at `/`, below.

The system rejects the generated-interface vocabulary on purpose: no rounded cards in a grid,
no coloured side-tab accents, no gradient pills, no spinners, no modals, no easing curves.

**Key Characteristics:**

- One warm stock (bone, page, leaf) under a seven-hue wheel that means _division_, never accent
- Hairline rules and one ply shadow carry all depth; nothing floats
- Archivo caps for labels and heads, EB Garamond for sentences a person must act on, Spline
  Sans Mono for every datum and amount
- Four stepped motion tokens; the frame count is the size of the object that moved
- Vermilion appears on exactly one object, the errata slip
- Selection is a punched hole; absence is an em dash; a new row inks in

## Colors

Warm printed stock under a wheel of seven division hues, with vermilion held out for
corrections alone.

### Primary

- **Chrome yellow** (#eda600): the Sources board and the ground of the primary plate. The
  colour of the leaf hinged open over a section — solved at runtime to a translucent acetate
  (`--leaf-alpha` 0.203 over `--leaf-ground` #f0b731) so text on it clears 4.5:1.

### Secondary

The rest of the wheel, one hue per division; each is a board hue, never an accent inside a
page. The wheel is full, so an eighth division needs a decision (ADR 0019), not a hex:

- **Oxide** (#b24b1a): Customers.
- **Grass** (#3e782b): Journal.
- **Teal** (#0f7673): Raw lake.
- **Violet** (#634cb0): Models.
- **Sienna** (#7f4023): Reports.
- **Ultramarine** (#234c9e): People.

### Tertiary

- **Vermilion** (#cf2f16) with **Vermilion ink** (#8c1c09) on **Slip ground** (#fdf0eb): the
  errata slip and the lapsed status mark. Nowhere else, ever.
- **Granted green** (#1c5c33) and **Pending umber** (#6b4a00): the two status-mark tones that
  are neither ink nor vermilion.

### Neutral

- **Bone** (#efe9d9): the board the whole book lies on; the tab strip's ground.
- **Page** (#f7f3e7): the reading field inside the leaf, constant across divisions.
- **Leaf** (#fbf8f0): a sheet lying on the page — inputs, unprinted leaves, the token box.
- **Ink** (#16150f), **Ink 2** (#56513f), **Ink 3** (#6b6450): primary text, labels and quiet
  data, and the faintest tone that still letters a disabled control or a recorded absence.
- **Rule** (rgba 22,21,15 at 0.16) and **Rule strong** (rgba 22,21,15 at 0.44): the hairline
  that separates and the heavier rule that closes a block.

### Named Rules

**The Wheel Rule.** A hue in the wheel means _which division is open_ and paints only the
board, the tabs, the punch holes and the hinged leaf. It is never used for emphasis, a badge,
a chart series or a button inside a page.

**The Vermilion Rule.** Vermilion is held out of the wheel so the errata slip can be the only
thing wearing it. A destructive plate is an ordinary plate; the safety is the confirmation
step, not the colour.

**The Absence Rule.** A value the system does not have renders as an em dash in Ink 3, never
as a zero, never as an empty cell.

## Typography

**Display Font:** Archivo (with ui-sans-serif, system-ui) — variable width, set narrow
(`wdth` 80–88) in caps for every head, label, tab and plate.
**Body Font:** EB Garamond (with ui-serif, Georgia) — only for sentences a person is asked to
read and act on: consent statements, refusals, hints.
**Label/Mono Font:** Spline Sans Mono (with ui-monospace) — every datum, address, id, amount
and count, with tabular figures.

**Character:** A printed manual's pairing. Caps in a narrow grotesque do the wayfinding;
Garamond carries the one paragraph that has to be understood; the mono face makes a figure a
figure. Sizes are fixed in rem, never fluid: product UI is read at one distance and a heading
that shrinks inside a panel reads as broken.

### Hierarchy

- **Display** (700, 2.5rem, 1.05; `wdth` 88): the one `h1` on a leaf; 1.9rem on a phone.
- **Headline** (700, 1.75rem; `wdth` 88): a section head inside a leaf.
- **Title** (700, 1.25rem, letter-spacing −0.005em, uppercase; `wdth` 88): a grant's name,
  an unprinted leaf's title.
- **Lead** (Garamond, 1.125rem, 1.45): the sentence under an `h1` that says what the leaf is.
- **Body** (Garamond, 1.0625rem, 1.53, max 62ch): consent, refusals, notes, hints.
- **Label** (700, 0.6875rem, letter-spacing 0.15em, uppercase; `wdth` 82): every head in the
  margin column, every column heading, every plate.
- **Datum** (mono, 0.8125rem, tabular figures): ids, addresses, dates, counts; `datum--quiet`
  in Ink 2.

### Named Rules

**The Two Voices Rule.** Caps for wayfinding, Garamond for anything a person must read to
decide. Consent copy set in 13px UI sans is boilerplate, and boilerplate is what it must not
be.

**The Digits Rule.** A figure is always mono with tabular numerals. An amount is a string all
the way to the DOM and is grouped with `,` in every language; a count follows the reader's
language.

## Layout

The book is a CSS grid with named areas: the tab strip across the head, then the leaf. When
the assistant is open, a third area, the interleaf, sits beside the leaf; on a phone it takes
the leaf's place. The
strip is first in the DOM at every width; a phone moves it to the foot with
`grid-template-areas`, not with source order, so navigation precedes the page it navigates for
a keyboard and a screen reader whether it is drawn above or below.

Inside the leaf, a `.sheet` is a five-column grid: a **margin column** of 9.5rem
(`--head-col`) where every head hangs beside its content, then four content columns
(`minmax(0, 1fr)`) with a 1.5rem gutter, up to 78rem wide. A head trails a hairline rule to
the frame edge, which is what makes the margin read as structure. Bands are separated by a
`.band-rule` (2rem above, 1.5rem below). Vertical rhythm comes from the spacing scale
(0.25 · 0.5 · 0.75 · 1 · 1.5 · 2 · 3 · 4.5rem); a `.stack` is 1rem, `.stack--tight` 0.5rem.

Responsive behaviour is structural, not fluid: at 1100px the content narrows to two columns;
at 760px the margin column collapses to 0, the `h1` drops to 1.9rem, and the strip goes to the
foot. Lists are rows in a schedule, never a card grid — a lapsed grant must not have the same
footprint as a healthy one.

## Elevation & Depth

Rules, never shadows. Depth is _ply_: a sheet of board lying on a sheet of board, told by a
hairline at rest and by one ply shadow only where a leaf genuinely stands off the board it is
hinged above. There is no ghost-card treatment (a hairline under a shadow is two depth systems
disagreeing), no hover lift, and no blur behind anything.

### Shadow Vocabulary

- **Ply** (`box-shadow: 0 2px 3px rgba(22,21,15,0.1), 0 8px 18px rgba(22,21,15,0.13)`): the
  hinged leaf, and nothing else.
- **Punched hole** (`box-shadow: inset 0 1px 1px rgba(22,21,15,0.4)`): the selected tab's hole,
  a hinged leaf's punches, a checked punch box — an inset that shows the page beneath.

### Named Rules

**The Ply Rule.** Elevation is declared once, by the shadow. A surface that carries a hairline
border does not also carry a shadow, and a surface with a shadow does not also carry a border.

## Shapes

Cut board, not rounded card. Radii are cuts: a plate is cut at 2px, a leaf at 3px, an errata
slip at 1px; nothing is rounder than that. Borders are hairlines (1px) in Rule or Rule strong;
the errata slip alone has 2px rules top and bottom. A pending leaf shows a perforation — a
dashed hairline down its binding edge — rather than a coloured bar; nothing in the system
carries a coloured edge above 1px. Selection and hinging are shown by a punched hole (a 9–10px
circle in Page with an inset shadow), which is the one recurring silhouette.

## Components

Cut board, pressed plates, hinged leaves. Every control is printed, die-cut, and moves in
whole frames.

### Buttons (plates)

- **Shape:** die-cut, 2px cut corners, hairline keyline in Ink.
- **Plate (secondary):** transparent ground, Ink label in caps (0.6875rem, 0.13em), padding
  0.5rem × 0.9rem; the arrow glyph the manual uses for "go on" sits after the label on a
  primary action.
- **Plate primary:** Chrome ground, Ink label. There is no third button.
- **Hover / Focus:** hover inverts (Ink ground, Leaf label; primary inverts to Ink ground,
  Chrome label) in two frames; a struck plate travels 1px down and darkens to Ink 2 — the
  whole travel a printed control has.
- **Disabled:** Rule-strong keyline, Ink 3 label; a disabled primary sits on #ece7d6.
- **Small:** padding 0.3rem × 0.6rem, 10px label — for a withdraw or sign-out in a row.

### Language pair

Two plates bound as one control (`.langset`): outer corners cut, inner borders overlapped
into one rule; the chosen face is inked (Ink ground, Leaf label) and `aria-pressed`.

### Inputs / Fields

- **Style:** Leaf ground, Rule-strong hairline, 2px cut, mono text at 0.8125rem, padding
  0.5rem × 0.65rem; placeholder in Ink 3; a hint beneath in Garamond.
- **Focus:** border to Ink plus a 1px inset ring in Ink; no glow.
- **Disabled:** #e9e2d0 ground, Ink 3 text.

### Punch (checkbox and radio)

A 15px hole through the leaf: hairline circle in Ink on Leaf; checked fills with the current
board hue and an inset shadow; focus is a 2px Ink outline offset 2px. Selection is shown the
same way everywhere: the open tab, a hinged leaf's edge, a chosen item.

### Cards / Containers (leaves)

- **The grant row** (`.grant`): a row in a schedule, hairline-ruled beneath, four columns
  (name · account · when · actions) on a baseline grid. An **unprinted** grant (never
  connected) becomes a leaf: Leaf ground, hairline, 3px cut, taller, carrying the access
  statement. A **pending** grant is half-hinged: a dashed hairline down its binding edge and a
  16% wash of the board hue fading out by 38%.
- **The hinged leaf** (`.hinge`): a translucent acetate leaf hinged down over the board inside
  its own row — the board shows through at every edge, two punched holes down the binding
  edge, the ply shadow, and secondary ink mixed from the ground so hints stay above 4.5:1. It
  is never a modal; the page above and below stays in the document and the tab order.
- **The unprinted leaf** (`.unprinted`): an empty division — Leaf ground, hairline, 3px cut,
  padding 2rem × 1.5rem, max 58ch — that says what will be printed here and what to do.
- **Internal padding:** 1rem on a row, 1.5rem on a leaf, 3rem on a hinged leaf's binding
  side.

### Errata (the correction slip)

Vermilion 2px rules top and bottom on Slip ground, 1px cut, a caps mark in Vermilion ink
("ĐÍNH CHÍNH") with the errata glyph, the correction in Garamond, and one action. Tipped in
crooked (−0.4°, −3px) and landing square in three frames; `role="alert"`. An inline variant
sits inside a grant row with tighter padding.

### Status marks

Geometry first, word second, hue third: four different shapes — solid, half, struck, open —
for granted, pending, lapsed, absent, so a row survives greyscale. Caps label at 0.6875rem;
tones Granted green, Pending umber, Vermilion ink, Ink 2.

### Tables

`.table`: full width, collapsed borders, caption and column heads in caps (Ink 2) over a
Rule-strong hairline; cells at 0.8125rem with a Rule hairline beneath, baseline-aligned;
numeric cells (`.num`) right-aligned; the last column right-aligned with no right padding.
The row wash on hover is 8% of the board hue, arriving in two frames. A new row inks in.

### Navigation (the tab strip)

Top tabs across the head on Bone: each tab in its division's hue with lettering solved per
hue for contrast, caps at 0.6875rem with 0.15em tracking, 3px cut on the top corners, a
Rule-strong hairline on the edge that meets the leaf. Width is the division's `extent`.
A tab that is not current sits retracted 0.75rem toward the leaf and rises 0.25rem on hover;
the current tab stands proud and its selection is a punched hole at the label's line. A
division that cannot open renders face-down: a diagonal hatch of board back with the reason in
its accessible name. The whole leaf turns 5° about its spine in four frames when the division
or the customer changes, and does not turn for a panel hinging open inside a section.

### Token

A one-time secret set large (1.125rem mono, bold, 0.04em) in a Leaf box with an Ink keyline,
`user-select: all`, so it can be read aloud over a phone and copied even if the clipboard
fails.

### Skeleton

Lines of type being set — a stepped stripe animating in six frames — not a spinner; the shape
of what is coming keeps the leaf from jumping when it lands.

## The Public Cover

The page at `/` is the undercroft beneath the book, lit by the visitor's lamp, and it follows the
reader's colour scheme (ADR 0064). In light it is the book as printed: the page stock and the
book's tokens from header to footer, the vault drawn in Ink. In dark the whole page is the book
inverted: every child of `.landing` remaps the book's own tokens onto Ink (Ink becomes Bone
lettering, Leaf becomes the Ink ground), so plates, links, focus rings and the language pair
invert by their existing rules and nothing is re-drawn. The vault's painter has a palette for
each scheme, and a test holds both to WCAG contrast on their own ground.

It is the one surface where motion is continuous (ADR 0063). A canvas film behind the headline
draws the data path as the platform's rules: one gate admitting records one at a time, a lake
that lays each new hash once and echoes a repeat onto its original, refusals kept struck in a
tray, and models feeding a report. It also draws the reader's six steps, from an invitation to
a question, each one threaded to the part of the data it moved. The pointer is the only light.
The vault's vanishing point swings away from it, the ribs can be read only near it, records part
around it, the column under it takes its division's hue lifted toward Bone, and the record under
it shows a proof slip with its content address.

- **The lamp beyond the cover** (ADR 0065): the same light follows the pointer over the header
  and the sheet, a warm core and a wide wash of Chrome under every section. Nothing on the sheet
  moves; only the light does.
- **Lamp colour:** `--lamp-ink`: Chrome at night, Chrome mixed 55% toward Ink by day, for the
  headline's second line and the reached step.
- **Cover ease:** `--cover-ease` (`cubic-bezier(0.16, 1, 0.3, 1)`), for the small states the
  film drives (a stage lit, a step reached), and nowhere else.
- **Reduced motion:** one settled frame, repainted as the pointer moves. The lamp and the proof
  slips still answer, nothing travels.
- **Cover sizes:** a 4.5rem headline (3.75rem under 1100px, 2rem on a phone) and a 1.5rem lead.
  These are local to the cover, not steps of the operating type ramp.

## Do's and Don'ts

### Do:

- **Do** put every head in the margin column and let it trail its rule to the edge; no page
  needs an eyebrow.
- **Do** give each state its own height and its own single next action: one line for a healthy
  row, a half-hinged leaf for pending, a tipped-in slip for a lapse.
- **Do** carry state by shape and word before hue: the four status geometries, the punched
  hole, the em dash.
- **Do** pick a motion token by the size of the object: `--hinge` (90ms, 2 frames) for a
  part, `--tip` (150ms, 3) for a slip, `--turn` (190ms, 4) for a leaf, `--pass` (120ms, 2,
  opacity only) for ink going down.
- **Do** render a missing value as an em dash in Ink 3 and a count through the reader's
  locale.
- **Do** open a panel as a hinged leaf inside its own row, with the page still in the tab
  order.

### Don't:

- **Don't** use an easing curve anywhere but the public cover; every other transition is
  `steps(n, end)`.
- **Don't** put vermilion on anything but an errata slip or a lapsed mark.
- **Don't** use a wheel hue as an accent, badge, chart colour or button inside a page.
- **Don't** lay out a list as a grid of equal cards, add a coloured side-tab bar, a gradient
  pill, a spinner, or a modal.
- **Don't** put a hairline border under a shadow; ply is declared once.
- **Don't** let a heading scale with the viewport; sizes are fixed in rem.
- **Don't** stagger a list's arrival; only a row that is genuinely new inks in.

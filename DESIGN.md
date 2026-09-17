---
name: VietCham Data Control Plane
description: A boxed-software reference manual lying open at a tabbed section — one customer is one book, each division a coloured section board, each panel a punched acetate leaf hinged above it.
colors:
  bone: "#efe9d9"
  page: "#f7f3e7"
  leaf: "#fbf8f0"
  ink: "#16150f"
  ink-2: "#56513f"
  ink-3: "#6b6450"
  rule: "rgba(22, 21, 15, 0.16)"
  rule-strong: "rgba(22, 21, 15, 0.44)"
  hue-oxide: "#b24b1a"
  hue-chrome: "#eda600"
  hue-grass: "#3e782b"
  hue-teal: "#0f7673"
  hue-ultramarine: "#234c9e"
  hue-violet: "#634cb0"
  hue-sienna: "#7f4023"
  errata: "#cf2f16"
  errata-ink: "#8c1c09"
  errata-ground: "#fdf0eb"
  leaf-ground: "#f0b731"
  mark-granted: "#1c5c33"
  mark-pending: "#6b4a00"
  board-back: "#d6cfba"
  board-back-alt: "#cec7b1"
  stock-disabled: "#e9e2d0"
  plate-disabled: "#ece7d6"
typography:
  display:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.5rem"
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: "-0.025em"
    fontVariation: "'wdth' 92"
  headline:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: "-0.025em"
    fontVariation: "'wdth' 88"
  title:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: "-0.015em"
    fontVariation: "'wdth' 96"
  body:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
    fontVariation: "'wdth' 100"
  prose:
    fontFamily: "EB Garamond, ui-serif, Georgia, serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.53
    letterSpacing: "normal"
  prose-lead:
    fontFamily: "EB Garamond, ui-serif, Georgia, serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
  label:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: "0.15em"
    fontVariation: "'wdth' 82"
  tab:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: "0.16em"
    fontVariation: "'wdth' 82"
  datum:
    fontFamily: "Spline Sans Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
    fontFeature: "'tnum' 1"
  token:
    fontFamily: "Spline Sans Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: "0.04em"
  caption:
    fontFamily: "Spline Sans Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "9px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0.24em"
rounded:
  leaf: "3px"
  plate: "2px"
  slip: "1px"
  punch: "50%"
spacing:
  s-1: "0.25rem"
  s-2: "0.5rem"
  s-3: "0.75rem"
  s-4: "1rem"
  s-5: "1.5rem"
  s-6: "2rem"
  s-7: "3rem"
  s-8: "4.5rem"
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
  plate-active:
    backgroundColor: "{colors.ink-2}"
    textColor: "{colors.leaf}"
  plate-disabled:
    backgroundColor: "transparent"
    textColor: "{colors.ink-3}"
  plate-primary:
    backgroundColor: "{colors.hue-chrome}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.plate}"
    padding: "0.5rem 0.9rem"
  plate-primary-hover:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.hue-chrome}"
  plate-primary-disabled:
    backgroundColor: "{colors.plate-disabled}"
    textColor: "{colors.ink-3}"
  plate-small:
    typography: "{typography.label}"
    padding: "0.3rem 0.6rem"
    rounded: "{rounded.plate}"
  input:
    backgroundColor: "{colors.leaf}"
    textColor: "{colors.ink}"
    typography: "{typography.datum}"
    rounded: "{rounded.plate}"
    padding: "0.5rem 0.65rem"
  punch-box:
    backgroundColor: "{colors.leaf}"
    rounded: "{rounded.punch}"
    height: "15px"
    width: "15px"
  punch-box-checked:
    backgroundColor: "{colors.hue-chrome}"
    rounded: "{rounded.punch}"
  rail-tab:
    backgroundColor: "{colors.hue-chrome}"
    textColor: "{colors.ink}"
    typography: "{typography.tab}"
    rounded: "0 3px 3px 0"
    padding: "1rem 0"
    width: "3.25rem"
  rail-tab-disabled:
    backgroundColor: "{colors.board-back}"
    textColor: "#5f5844"
  hinge-leaf:
    backgroundColor: "{colors.hue-chrome}"
    textColor: "{colors.ink}"
    rounded: "{rounded.leaf}"
    padding: "2.0625rem 2.0625rem 2.0625rem 3.5625rem"
  errata-slip:
    backgroundColor: "{colors.errata-ground}"
    textColor: "{colors.ink}"
    typography: "{typography.prose}"
    rounded: "{rounded.slip}"
    padding: "1rem 1.5rem"
  unprinted-leaf:
    backgroundColor: "{colors.leaf}"
    textColor: "{colors.ink}"
    rounded: "{rounded.leaf}"
    padding: "2rem 1.5rem"
    width: "58ch"
  token-box:
    backgroundColor: "{colors.leaf}"
    textColor: "{colors.ink}"
    typography: "{typography.token}"
    rounded: "{rounded.plate}"
    padding: "1rem"
---

# Design System: VietCham Data Control Plane

## Overview

**Creative North Star: "The Acetate Tab Board"**

The control plane is a boxed-software reference manual lying open at a tabbed
section. One customer is one book; each division is a coloured section board;
each panel is a punched sheet of milk acetate hinged a millimetre above that
board, with the board still readable through it. What this product records is
standing authorities — who granted what, over which scope, until when — and that
is a document, not a telemetry surface. The world is the world key
`rw-manual-acetate-tab-board`, seed `62ae625c`.

Rank in this system is **ply**: a leaf's height in the stack is its importance.
Not size, not colour, not a badge. That one commitment settles most of the
system downstream — the four connection states are four geometries before they
are four hues, navigation is a fore-edge tab rail rather than a sidebar, and the
single raking light means containers are hairline rules and exactly one object
in the whole interface casts a shadow. The visual anti-reference is explicit and
was the arrangement this repo previously shipped: left sidebar, page header, and
source cards three-up in a grid with a status pill each. A card grid gives a
lapsed grant the same footprint as a healthy one, which is the single thing this
interface exists to prevent.

The register is printed matter, warm and dry: bone board, near-black ink, seven
saturated section hues at full strength, and nothing that eases, fades, glows or
gradients. Where there is warmth it is in the paper and in the Garamond, which
is reserved for the sentences a person is actually asked to read before handing
over access to their accounting system and company mailbox.

**Key Characteristics:**

- Rank is ply, never size or colour.
- One raking light: hairline rules everywhere, exactly one shadow in the system.
- The reading field over a saturated board is solved at runtime, not guessed.
- Vermilion is held out of the section wheel and means errata only.
- Four connection states are four geometries; hue is the third carrier.
- Two hard frames at 90ms, hinged at the punch. Nothing eases or fades.
- Three type voices — display, prose, machine — and no fourth.

## Colors

Printed matter: a warm bone stock, a near-black ink that is not black, and a
wheel of seven saturated divider-board hues taken in binding order, with one
colour deliberately missing from the wheel.

### Primary

- **Chrome Yellow** (`#eda600`): the SOURCES division board, and the ink in the
  one primary control. It is the only hue that also does duty as a button fill,
  because it is the hue the default board wears.
- **Ink** (`#16150f`): every word of consequence, every hairline, the focus
  frame, and the hover fill of a plate. Near-black, warmed, so it sits on bone
  as printed ink rather than as screen black. Measures 16.48:1 on the page
  stock.

### Secondary — the section wheel

Seven hues divide the book and are taken in order. Four are spoken for; three
are the system's room to grow, and a new division takes the next hue rather than
inventing one. Each drives the tab, the punch holes, the hinged leaf's board and
the table row hover for its division, and nothing else.

- **Oxide Orange** (`#b24b1a`): CUSTOMERS, extent 2. Darkened from `#c2521c` so
  its tab could be lettered at 4.5:1.
- **Chrome Yellow** (`#eda600`): SOURCES, extent 4. The system's default board.
- **Forest Teal** (`#0f7673`): RAW LAKE, extent 3.
- **Ultramarine** (`#234c9e`): PEOPLE, extent 2. The deepest board in the wheel,
  and the hue that makes the runtime solver necessary.
- **Grass** (`#3e782b`), **Violet** (`#634cb0`), **Sienna** (`#7f4023`):
  unclaimed. Grass was darkened from `#45852f` for the same lettering reason as
  oxide.

### Tertiary — errata

- **Vermilion** (`#cf2f16`): rules top and bottom of a correction slip. Nothing
  else, anywhere.
- **Errata Ink** (`#8c1c09`): the slip's caps mark and the lapsed status mark
  (8.24:1 on the slip's ground).
- **Slip Ground** (`#fdf0eb`): the tipped-in slip's paper.

### Neutral

- **Bone Board** (`#efe9d9`): the body ground and the tab rail's own stock — the
  board the whole book is bound on.
- **Page Stock** (`#f7f3e7`): the reading field of the open leaf. Constant
  across divisions: turning to another section does not recolour what you read,
  only the fore edge, the punch holes and the hinged leaf.
- **Leaf White** (`#fbf8f0`): the unprinted leaf, input fields, the token box —
  a fresh sheet laid on the page.
- **Secondary Ink** (`#56513f`): labels, quiet data, captions (7.16:1 on page).
- **Faint Ink** (`#6b6450`): disabled labels and every recorded absence. Held at
  5.31:1 on the page stock — WCAG exempts a disabled control, but a label nobody
  can read is a defect whatever the exemption says. On a hinged leaf it is not
  this value: it is re-mixed from the solved ground at 70% ink, and at that
  strength it is an approved tone there, clearing 5.00:1 on the worst hue in the
  wheel.
- **Hairline** (`rgba(22, 21, 15, 0.16)`) and **Closing Rule**
  (`rgba(22, 21, 15, 0.44)`): the two rule weights. There is no third.
- **Board Back** (`#d6cfba` / `#cec7b1`): the 135° hatch of a face-down leaf —
  a disabled tab is a leaf turned over, showing unprinted board back.

### Status marks

- **Granted Green** (`#1c5c33`), **Pending Bronze** (`#6b4a00`), **Lapsed**
  (errata ink), **Absent** (secondary ink). All four measure above 7:1 on the
  page, and all four are the *third* carrier of their state.

### Named Rules

**The Held-Out Vermilion Rule.** Seven hues divide the book; the eighth is not
in the wheel. Vermilion appears on errata and nowhere else — not on destructive
controls, not on carets, not on a hover state, not as a chart series. A
`.plate--revoke` variant was built and then deleted for exactly this reason:
three DISCONNECT buttons on healthy rows competed with the one slip that
mattered. The safety on a destructive action is its confirmation step, not its
colour.

**The Solved Field Rule.** `--leaf-alpha` and `--leaf-ground` are never
authored. `@/lib/acetate` binary-searches sRGB source-over compositing against
the live board hue until the composited field clears `TARGET_CONTRAST` (10:1)
against the ink, takes the *lowest* alpha that does, and publishes both as
custom properties on the document element. The values checked into `:root`
(`0.203` / `#f0b731`) are the solver's own chrome-yellow answer, so first paint
is already correct. Chrome yellow solves at 0.203 coverage; ultramarine needs
0.676. No hand-picked constant serves both, and `acetate.test.ts` walks all
seven wheel hues plus every live division.

**The Derived Lettering Rule.** A label on a saturated ground is never a fixed
colour. `letteringOn()` picks ink or paper per hue by measured contrast — white
on the chrome board is 2.09:1, which is what the rail shipped with until it was
measured. Two wheel hues were darkened rather than lettered badly. A hue neither
house colour can letter at 4.5:1 does not belong in the wheel, and the test says
so.

## Typography

**Display Font:** Archivo (variable, `wdth` 62–125, `wght` 400–700), with
`ui-sans-serif, system-ui, sans-serif`
**Body Font:** EB Garamond (variable, `wght` 400–600, roman + italic), with
`ui-serif, Georgia, serif`
**Label/Mono Font:** Spline Sans Mono (variable, `wght` 400–700, latin only),
with `ui-monospace, SFMono-Regular, Menlo, monospace`

All three are self-hosted and subset by `unicode-range` to latin / latin-ext /
vietnamese, under the SIL OFL 1.1. This origin holds the session cookie that
opens every stored OAuth credential; it has no business making a third-party
request on every page load.

**Character:** Archivo stands in for Univers — one grotesque with a real width
axis, so the condensed headline voice and the upright UI voice come out of one
file rather than out of two families. EB Garamond stands in for Sabon and
carries every sentence a customer must read before granting access: consent copy
set in 13px UI sans reads as boilerplate, and boilerplate is precisely what it
must not be. Spline Sans Mono is machine voice only.

The ramp is fixed in rem, never fluid. Product UI is read at a consistent
distance, and a heading that shrinks inside a panel reads as broken rather than
as responsive. Only the two largest steps change, and only below 760px.

### Hierarchy

- **Display** (700, 2.5rem / 1.9rem below 760px, 1.08, `wdth` 92, uppercase,
  `-0.025em`): the page's one H1 — FINISH SETTING UP, the customer index.
- **Headline** (700, 1.75rem / 1.4rem below 760px, 1.08, `wdth` 88, uppercase):
  section headings within a division.
- **Title** (700, 1.25rem, 1.08, `wdth` 96): the hinged leaf's question, an
  unprinted leaf's title, and a source's name on the schedule (`wdth` 88,
  uppercase).
- **Body** (400, 0.9375rem, 1.5, `wdth` 100): the default UI voice; rarely the
  right answer for a sentence.
- **Prose** (400, 1.0625rem, 1.53, max 62ch): Garamond. What a source will read,
  what it will never write, what a refusal means, what happens if a token is
  lost. Lead variant at 1.125rem / 1.45.
- **Label** (700, 0.6875rem, `0.15em`, uppercase, `wdth` 80–86): hanging heads,
  field labels, table headers, the access statement's terms, status words, plate
  lettering. Tracking widens to `0.16em` on rail tabs, `0.2em` on the wordmark
  and the errata mark, `0.24em` on the spine caption.
- **Datum** (mono, 0.8125rem, tabular figures): identifiers, digests, accounts,
  cron, byte counts, dates. Every figure in this product is compared down a
  column, so `tnum` is on wherever mono is.
- **Token** (mono, 700, 1.125rem, `0.04em`, `user-select: all`): the one-time
  invitation token, set large enough to be read aloud over a phone.

### Named Rules

**The Three Voices Rule.** Display, prose, machine. There is no fourth face and
no fourth role. A new kind of text belongs to one of the three or it does not
belong on the page.

**The Machine Voice Rule.** Monospace is for values a machine produced —
identifiers, digests, dates, cron, counts, addresses. Never for atmosphere, and
never for navigation: the rail is lettered in Archivo precisely because
monospace as a costume for "technical" is the tell. This is a deviation from the
direction contract's own FIRST VIEWPORT, taken deliberately.

**The 62ch Rule.** Every Garamond block is capped at 62 characters (58ch inside
the access statement and the unprinted leaf). Prose that runs the full width of
a four-column grid is prose nobody finishes.

## Layout

The frame is the book: a two-column CSS grid, content leaf plus a `3.25rem`
fore-edge rail, filling the viewport height. The leaf carries a `3rem` spine
holding two punch holes and a rotated running foot, and its left padding clears
that spine plus a gutter (`calc(3rem + 1rem)`) so hanging heads do not sit
against the spine rule.

Inside the leaf, the page is a **four-column grid with the heads hanging in a
fifth margin column**: `grid-template-columns: 9.5rem repeat(4, minmax(0, 1fr))`
with a `1.5rem` column gap and a `78rem` maximum measure. Each head sits in
column 1 in micro-caps and **trails a hairline rule to the frame edge**, which
is what makes the margin column read as structure rather than as a stack of
loose labels. Content occupies `2 / -1`. This is also why no page here carries
an eyebrow: the label sits *beside* its heading, not stacked on top of it.

The spacing rhythm is an eight-step scale from `0.25rem` to `4.5rem`, growing
roughly 1.5×. Stacks default to `1rem`, tight stacks to `0.5rem`, rows to
`0.75rem`. A band rule (`2rem` above, `1.5rem` below) closes a block across the
full grid.

Sources are a **full-width schedule of rows**, not a field of equal cards: rows
under a closing rule, each state taking the height it deserves — a granted
source is one line, an awaiting-scope source is half-hinged off a perforated
binding edge, an ungranted source is a taller unprinted leaf carrying the whole
access statement, and a lapsed grant tips in a correction slip.

**Responsive.** Width deals fewer leaves, four columns to two to one.
At `≤1100px` the sheet drops to two content columns and the grant row's four
columns become two, with actions spanning. At `≤760px` the margin column
collapses to zero, the book becomes two rows, and the fore-edge rail becomes a
horizontally scrolling **bottom tab strip** — same hues, same punch, same
extend, rotated upright, at the foot because that is where a thumb is and
because the leaf's own heading should be the first thing on screen. The spine
and its caption are dropped. The division label in the margin column is
`display: none` on a phone rather than allowed to stack over the H1, because
letterspaced micro-caps directly above a heading is an eyebrow.

### Named Rules

**The Fore-Edge Rule.** Navigation lives on the fore edge, and tab height is
proportional to each division's `extent` (2 / 4 / 3 / 2), so the rail is a
picture of the book as well as a control. Extent is a property of the division,
never a measurement of the current customer's data — a tab that resized itself
as rows arrived would move the navigation under the operator's cursor. A left
sidebar would make this a dashboard wearing a manual's colours.

**The Hanging Head Rule.** Section labels hang in the margin column and trail
their rule to the frame edge. Because the head is beside the heading, no surface
in this system needs a kicker or an eyebrow, and none may introduce one.

## Elevation & Depth

Depth is **ply** and nothing else. Containers are hairline rules — never a
shadow, never a gradient, never a border that suggests a raised card. The system
declares its elevation exactly once: a single shadow token applied to a leaf
standing off the board it is hinged above, and to the title page's one centred
leaf. A shadow anywhere else would be a second, lying depth system.

The corollary is enforced: the hinged leaf carried a hairline border *under* the
ply shadow during the build and it was removed, because a border plus a shadow
is the ghost card — two depth systems disagreeing about which one is real. The
focus treatment is a hard offset frame rather than a glow for the same reason.

### Shadow Vocabulary

- **Ply** (`box-shadow: 0 2px 3px rgba(22,21,15,0.1), 0 8px 18px rgba(22,21,15,0.13)`):
  a leaf hinged open above its board. Offset plus soft blur, so it reads as
  height rather than as a coloured halo. The only shadow in the system.
- **Punch** (`box-shadow: inset 0 1px 1px rgba(22,21,15,0.35)` on leaf punches
  and the tab's current-hole; `inset 0 1px 2px rgba(22,21,15,0.4)` on the hinge
  punches and the checked selection hole): not elevation — the inner edge of a
  hole, which is the opposite gesture and the only other use of a box-shadow.

### Named Rules

**The One Shadow Rule.** There is one shadow and it means one thing: this leaf
is hinged above the board. Anything that is not a hinged leaf is separated by a
rule.

**The Two-Weight Rule.** Hairline (`0.16` alpha) separates; the closing rule
(`0.44` alpha) ends a block. Both are 1px. There is no third weight and no
coloured edge above 1px anywhere in the system — a 3px board-hue bar down a
binding edge was built twice and removed twice, because a coloured side-tab
accent is the most recognisable tell of a generated interface.

## Shapes

A cut sheet of board, not a rounded card. Radii are near-zero and mean
something: `3px` is a leaf (a hinged panel, an unprinted leaf, a tab's outer
corners, the title page), `2px` is a die-cut plate or a field, `1px` is a tipped
slip. Anything circular is a **hole**: leaf punches at 11px, hinge punches at
10px, the tab's current-mark at 9px, the selection box at 15px.

The recurring silhouette is the punched leaf — a rectangle with two holes down
its binding edge — and it appears at three scales: the page itself, the hinged
panel, and the checkbox. A hole is filled with what lies *behind* it (the page
stock), never with the board hue: the hinge punches were board-coloured on a
board-coloured ground and read as two faint smudges rather than two holes.

The perforation is the system's dashed edge: a 1px dashed rule on a half-hinged
row's binding edge, and above the access statement. It is the only dashed line
in the system.

### Named Rules

**The Punch Rule.** Selection is a hole, everywhere. A checked box is a punched
disc filled with the board hue and inset-shadowed; the current tab is a punched
hole showing the page through it. No checkmarks, no filled squares, no pills.

## Components

### Buttons — the plate

A plate, printed and die-cut. There is no third button.

- **Shape:** a die-cut rectangle (`2px` radius) with a hairline ink keyline.
- **Primary:** chrome-yellow ground, ink lettering (8.76:1), micro-caps at
  `0.13em`, `0.5rem 0.9rem`, trailing the manual's own right-arrow mark at 13px.
- **Secondary:** the same die with no ink in it — transparent ground, ink
  keyline. This is what DISCONNECT wears; revocation is an ordinary plate.
- **Hover / active:** the plate inverts in two hard frames (90ms) — ink ground,
  leaf lettering; primary inverts to ink ground with chrome lettering. Active
  drops to secondary ink.
- **Disabled:** keyline drops to the closing rule, lettering to faint ink; the
  primary's fill drops to a near-paper tint (`#ece7d6`) chosen so the faint ink
  still clears 4.5:1 on it (4.76:1). The darker fill it replaced put its own
  label at 4.3:1.
- **On a hinged leaf:** a disabled plate does *not* use the page's pale fill —
  that reads as a hole punched in the board. It becomes transparent, with its
  border mixed from the solved ground at 40% ink and its lettering taking the
  leaf's own re-mixed faint ink (70%) rather than restating that mix inline —
  one value, not two that have to agree.
- **Small:** `0.3rem 0.6rem` at 10px, for the sign-out plate in the running head.

### Inputs / Fields

- **Style:** mono at 0.8125rem on leaf white, closing-rule keyline, `2px`
  radius, `0.5rem 0.65rem`. The value is machine voice, so the field is set in
  the machine face.
- **Hover:** keyline darkens to secondary ink. **Focus:** keyline to full ink
  plus a 1px inset ring — thickening the same line rather than adding a glow.
- **Disabled:** stock drops to `#e9e2d0`, text to faint ink.
- **Hint:** Garamond at 1rem in secondary ink, capped at 62ch, wired by
  `aria-describedby`.

### Selection — the punch

- **Style:** a 15px ink-keylined disc on leaf white, with the label in mono
  beside it at `0.75rem` gap.
- **Checked:** filled with the current board hue and inset-shadowed, so it reads
  as punched through rather than ticked.
- **Focus:** the house 2px ink outline at 2px offset on the disc.

### Navigation — the fore-edge tab rail

- **Style:** vertical tabs on bone stock, each a saturated board with its label
  in Archivo micro-caps at `0.16em`, rotated upright (`vertical-rl`), lettered
  by `letteringOn()` per hue. `flex-grow` equals the division's extent.
- **Default:** slid `0.75rem` off the fore edge by transform (never margin —
  animating margin reflows the rail on every hover).
- **Hover:** slides to `0.5rem`. **Current:** slides flush to zero and gains a
  9px punched hole near its head showing the page stock through it.
- **Face-down (locked):** a 135° two-tone hatch on board back, slid furthest out
  at `1rem`, `aria-disabled` with the reason in the accessible name. Divisions
  scoped to one customer render face-down rather than disappearing, because a
  division that vanishes teaches nobody that it exists.
- **Mobile (≤760px):** the same tabs as a bottom strip — horizontal, top-rounded,
  extra left padding so the punch never lands on the label, `env(safe-area-inset-bottom)`
  honoured.

### The grant row (signature)

One source's standing grant, as a row on a schedule rather than a card in a
grid. A four-column head — name and status / account and scope / schedule and
expiry / actions — separated by hairlines under one closing rule.

- **Granted:** one line. Account, what it reads, its cron in plain words, its
  expiry.
- **Awaiting scope (half-hinged):** a 1px *dashed* binding edge plus a 16%
  board-hue wash fading out by 38%. A shape before it is a colour.
- **Not granted (unprinted leaf):** leaf-white ground, hairline keyline, `3px`
  radius — taller than the others on purpose, carrying the two-row access
  statement (WHAT WE READ / WHAT WE CHANGE) in Garamond above a perforated rule,
  because that is the decision being asked for.
- **Lapsed:** the row tips in an inline errata slip.

### Status marks

Four states, four **geometries** on one 16-unit grid at one 1.5-unit stroke:
solid disc (granted), half-inked disc (awaiting scope), struck disc (lapsed),
dashed outline (not granted). The word follows the mark; the hue is third and
least load-bearing, so a row survives greyscale, a colour-blind reader and a bad
monitor. Every mark is `aria-hidden`; the word beside it is the accessible name.

### Errata slip (signature)

The slip a publisher tips into a book to correct something already printed. 2px
vermilion rules top and bottom, a pale vermilion ground, a caps mark with the
correction cross, the correction itself in Garamond, and exactly one recovery
action. `role="alert"` only when the state *arrived*, never for something
already on the page. It is the loudest object on any page it appears on, because
a lapsed grant is the state that actually happens in production.

### The hinged leaf (signature)

The system's signature move, and the one thing that casts a shadow. A section of
board (`3px` radius, ply shadow) with a genuinely translucent acetate sheet
painted 9px inset inside it via `::before` at the solved `--leaf-alpha`, two
punch holes down its binding edge showing the page stock through, and content
riding above the sheet. It animates in with `hinge-down`: `rotateX(-14deg)` to
flat, two steps, 90ms, `transform-origin: top left`.

It is **not a modal**. It hinges open inside its own row, so the board above and
below stays in the document, in the tab order and on screen. The quieter inks
inside it are re-mixed *from the solved ground* — secondary at 78% ink, faint at
70% — because the page's greys are calibrated for bone and secondary measured
4.35:1 on the chrome board. Both re-mixed tones are approved for use on a hinged
leaf: 78% holds 6.19:1 and 70% holds 5.00:1 on the worst hue in the wheel.

### Empty and loading

- **Empty** is an unprinted leaf — the same object with no ink on it yet —
  saying what will be printed here and what to do about it. Never a dashed
  placeholder box: a dashed box is a hole in the page.
- **Loading** is lines of type being set: a stepped repeating rule at
  `steps(6, end)` over 1.1s, ragged widths, `aria-busy`. Never a spinner, and
  never a stack of identical full-width bars — that is the one shape real
  content never has.

## Do's and Don'ts

### Do:

- **Do** let the runtime solver own the reading field. Read `--leaf-alpha` and
  `--leaf-ground`; never author a literal alpha over a board hue.
- **Do** derive a label colour on any saturated ground with `letteringOn()`, and
  re-mix the quieter tones from `--leaf-ground` rather than inheriting the
  page's — 78% ink for secondary, 70% for faint. Both are approved on a hinged
  leaf; take the token, don't restate the mix inline.
- **Do** give a new state its own geometry first, its own word second, and its
  hue third.
- **Do** separate with a hairline rule (`0.16`) and close a block with the
  strong rule (`0.44`).
- **Do** take the next unclaimed wheel hue for a new division, and add it to
  `DIVISIONS` with an honest `extent` — and check `acetate.test.ts` still passes,
  which is the gate on whether the hue can be lettered at all.
- **Do** set prose a person must act on in Garamond at 62ch; set anything a
  machine produced in Spline Sans Mono with tabular figures.
- **Do** hang the section label in the margin column with its trailing rule.
- **Do** render a recorded absence as an em dash in faint ink — never a zero,
  never an empty cell.
- **Do** keep motion to `steps(2)` at 90ms hinged at the punch, and collapse it
  to a single frame under `prefers-reduced-motion`.

### Don't:

- **Don't** use vermilion (`#cf2f16` / `#8c1c09`) for anything but errata. Not
  destructive controls, not carets, not hover states, not a chart series.
- **Don't** add a second shadow. If it is not a leaf hinged above its board, it
  is separated by a rule.
- **Don't** put a border under the ply shadow. Elevation is declared once.
- **Don't** introduce a coloured edge thicker than 1px — a board-hue side bar is
  the generated-interface tell this world has removed twice.
- **Don't** lay out equal-size cards in a grid as page structure. States get the
  height they deserve; a schedule is the form.
- **Don't** write an eyebrow or kicker above a heading. The hanging head already
  does that job, and on mobile the division label is hidden rather than allowed
  to stack.
- **Don't** letter a saturated board in a fixed white. White is 2.09:1 on chrome
  yellow.
- **Don't** set navigation, headings or UI labels in the mono face; it is
  machine voice only.
- **Don't** ease, fade, glow, or gradient. The two gradients in the build are a
  135° hatch (a face-down leaf) and a hard 38% wash (a half-hinged row); neither
  is decorative depth.
- **Don't** use Unicode characters (`●▲◆○`) as status glyphs. Marks are authored
  geometry at one stroke weight.
- **Don't** open a panel as a modal. The board stays on screen and in the tab
  order.

## Measurement notes

Recorded so a later reader does not "fix" a non-defect by trusting a tool over
the page.

- **The disabled `SAVE AND FINISH` plate inside a hinged leaf.** A canvas-based
  contrast sweep cannot resolve a `::before` background, so it measures that
  label against the raw board (`rgb(237,166,0)`) and reports **4.38:1**. The
  label actually sits on the composited ground — board plus the `::before`
  acetate at alpha 0.204 — which is `rgb(240,183,49)`, exactly the published
  `--leaf-ground`, and it measures **5.02:1** there. The page is correct; the
  tool cannot see through the pseudo-element.
- **Solved alphas per wheel hue** (leaf `#fbf8f0` over the hue, target 10:1):
  chrome 0.203, grass 0.610, teal 0.624, oxide 0.627, violet 0.645, sienna
  0.671, ultramarine 0.676. Each lands at 10.0–10.01:1 against the ink.
- **Tab lettering per hue:** ink on chrome (8.76:1); paper on grass (5.04:1),
  oxide (5.06:1), teal (5.13:1), violet (6.20:1), sienna (7.44:1), ultramarine
  (7.61:1).
- **The hinged leaf's re-mixed inks, worst hue in the wheel.** These are governed
  by **sienna**, not by chrome: measured against each hue's own solved ground,
  secondary at 78% ink bottoms out at 6.19:1 and faint at 70% bottoms out at
  5.00:1. Faint was 62% during the build, which bottoms out at 4.04:1 on sienna —
  below the floor, and invisible on chrome, which measures 4.05:1 there. It was
  raised to 70% before ship, so both tones now clear 4.5:1 on all seven hues
  including the three no division has claimed.

## Known gap

The build reaches this world's structure, state grammar and palette, but not its
full material range. Native devices of the source world that are named and not
yet rendered: **acetate gloss, paper grain, halftone print ink, stacked tab ply,
and the manual's reference apparatus** (cross-references, marginal annotation).
The finish review's disposition was `ship`, scoped to the fixes it listed, with
this ceiling gap left explicitly open. A future pass that reaches for more
material should reach for these, not for new devices.

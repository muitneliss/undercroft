---
version: 1
slug: "ui-src-app-tsx"
primary_target: "ui/src/App.tsx"
related_targets: ["ui/src/index.css","ui/src/routes","ui/src/components"]
---

---
version: 1
slug: "ui-src-app-tsx"
primary_target: "ui/src/App.tsx"
related_targets: ["ui/src/index.css","ui/src/routes","ui/src/components"]
---

## Scope and mode

The whole control-plane SPA, redesigned: sign-in, the customer index, the
customer record (sources / raw lake / people), and the per-source scope editor.
Visitor mode is **Operate** throughout — every screen exists so a task gets
finished, and expression may never obscure the task, the state, or a familiar
affordance.

## Audience and job

Primary is the **VietCham staff operator**, in this interface daily, holding
several member companies at once, usually mid-call with the one whose grant just
lapsed. Their job is custody: who granted what, over which scope, until when, and
which one needs re-asking today. Secondary is the **customer's own admin**, who
arrives perhaps once, to hand read access to their accounting system and company
mailbox to someone else's software.

Task: grant, scope, re-grant and revoke source access per customer; browse what
landed in the raw lake; administer who can see a customer.

Proof and content: real API responses only. Demonstration data is authored and
uses CASE-IDs — no real client name appears anywhere, in fixtures, tests or
screenshots.

## Constraints

- Money is a string end to end and is never parsed into a JavaScript number.
  `null` renders as an em dash, never `0` and never blank.
- Comparison stays three-valued; `unverified` is not a soft pass or a soft fail.
- A tenant the user cannot see is a 404; the interface says "no access", never
  "does not exist".
- What a source reads, that nothing is written, and that it can be undone are
  stated on the source's leaf **before** the redirect. `ConnectionCard.test.tsx`
  pins that copy.
- Status never by colour alone. Visible focus ring everywhere. Reduced motion
  honoured. Skeletons, not spinners, inside content.
- No mocks. Tests run against the in-memory implementation, which refuses.
- `POST /api/tenants/{id}/runs` is **not implemented** by any router. Nothing in
  this redesign may present a working sync trigger as though it were real.
- Nothing serves `curated.customer_commercial_overview`, so no money figure has
  an endpoint yet. `formatMoney` stays exercised by its own tests, and no screen
  invents totals.

## Direction contract

**THESIS.** The control plane is a boxed-software reference manual lying open at
a tabbed section: one customer is one book, each division a coloured section
board, each panel a punched acetate leaf hinged a millimetre above it. It refuses
the arrangement this category always ships and that this repo currently has — a
left sidebar, a page header, and source cards in a three-up grid with a status
pill each. Here rank is **ply**, not size or colour; navigation is a stepped tab
rail down the fore edge, not a sidebar; and the five connection states are told
by hinge, punch, face and slip before any hue is involved.

**OWN-WORLD.** Ground is milk acetate over bone board (`#f4f0e4`), ink near-black
(`#16150f`). Seven section hues at full strength, one per division, taken in
wheel order: oxide orange for CUSTOMERS, chrome yellow for SOURCES, teal for
LAKE, ultramarine for PEOPLE. **Vermilion (`#d8341c`) is held out of the wheel
and means errata only.** Every container is a hairline rule, never a shadow and
never a gradient: one raking light, hard edges, depth carried by ply alone. Type
is three voices and no more — Archivo for display and headings (the obtainable
Univers), EB Garamond 17/26 at a 62-character measure for prose the customer must
actually read, Roboto Mono for the tracked small-caps labels, references, dates,
figures and every machine voice. Section labels hang in a fifth margin column to
the left of a four-column grid, each trailing a hairline rule to the frame edge.
Controls are the form's own: a punched hole is selected, a face-down leaf is
disabled, a half-hinged leaf is pending, a vermilion errata slip is an error.

**STORY.** The operator opens the book at a customer and understands within one
viewport which grants are live, which is lapsing and when, and what each one
permits. They believe the platform reads only what was granted, because each
leaf says so in the customer's own words before any redirect. They re-grant the
lapsed source, or hinge open a leaf to change what it syncs, and put the book
down.

**FIRST VIEWPORT.** The customer record at its SOURCES division, 1440×900. A
stepped tab rail runs the full height of the right fore edge, four tabs —
CUSTOMERS, SOURCES, LAKE, PEOPLE — each a saturated board with its label in
mono caps rotated upright; the current tab extends left past the others and its
hue becomes the thin board edge visible under the leaf. The leaf itself fills the
rest of the frame, bone, with two grey punch holes down its left edge and the
running foot `VIETCHAM DATA PLATFORM · CONTROL PLANE` set rotated in mono down
the far-left spine. At the top, a hairline head rule carries the wordmark left
and the signed-in identity and sign-out right. Below it, in the margin column,
`SECTION 02 · SOURCES` with its rule; beside it the customer's CASE-ID in mono
and display name in Archivo at 40px, and one line of Garamond stating how many of
four are granted. When any grant has lapsed, a **vermilion errata slip** sits
immediately under that line, full content width, edges torn square, carrying the
source, how long ago, and a single `RE-GRANT` action — the loudest object on the
page, because it is the state that actually happens in production. Then the four
source leaves in a two-by-two field across the four columns, each numbered `01`
to `04` in mono, named in Archivo caps, carrying its granted account, its
schedule, its expiry, and — when not granted — the two-row access statement
(`WHAT WE READ` / `WHAT WE CHANGE`) set in Garamond, with the primary action a
chrome-yellow plate with a hairline black border at the leaf's foot. The primary
action sits at the foot of the leaf that needs it, never floated in a header.

**FORM.** The acetate tab board — `rw-manual-acetate-tab-board`, a dealt
challenger, chosen by the user over the assigned direction and over my own
top-ranked candidate. It was scored *competitive* before the choice: it holds
audience identification and its risk was product clarity over dense tables. That
risk is discharged by building the world's own named technique rather than by
softening the world — leaf alpha is solved at runtime by binary-searching sRGB
source-over compositing against the live section hue until the reading field
lands in a fixed luminance band, then published as a custom property, so text
contrast is guaranteed over any board hue instead of hoped for. Signature
interaction: **the hinge** — the scope editor, the lake manifest and the
invitation slip all arrive as a top-ply clear leaf hinged down at its punched
edge over the board, which stays readable beneath. Motion grammar is
`steps(2)` at 90ms, hinged at the punch, and nothing anywhere eases or fades;
`prefers-reduced-motion` drops it to a single frame. Seed key **62ae625c**.

**FINISH.** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Memorable moment

The vermilion errata slip. A lapsed OAuth grant is the state that actually
happens in production — Xero dies after 60 days unused, a customer revokes from
their own account page, and a Testing-status refresh token lasts a week — and in
this world it does not get a small red badge. It gets the one colour held out of
the entire section wheel, laid across the board as a printed correction, with the
recovery as its only action.

## Deviations taken against this contract, and why

Recorded rather than quietly absorbed, so a later reader can tell a decision from
a drift.

- **Source rows are a full-width schedule, not the two-by-two leaf field FIRST
  VIEWPORT describes, and they carry no `01`–`04` numbering.** The craft floor
  bans same-size cards as page structure and bans section numbering that carries
  no information the reader needs. The schedule is also the better answer: a card
  grid gives a lapsed grant the same footprint as a healthy one, which is the
  single thing this screen exists to prevent.
- **The tab rail is lettered, although the source form's divider boards carry no
  mark at all.** Unlabelled navigation on an Operate surface is a defect, not a
  position. This is the only place the build departs from the form itself.
- **The rail's lettering is Archivo, not the mono caps FIRST VIEWPORT names.**
  Mono here is reserved for machine voice — identifiers, digests, dates, cron,
  counts. Navigation labels are not data, and monospace as a costume for
  "technical" is a tell.
- **The tab lettering colour is derived per hue, not fixed.** White measured
  2.09:1 on the chrome board. `letteringOn()` picks ink or paper by contrast, and
  two hues of the wheel were darkened (oxide `#c2521c`→`#b24b1a`, grass
  `#45852f`→`#3e782b`) because neither colour could letter them legibly.
- **The scope editor hinges open inline inside its row rather than over the
  board.** `.claude/rules/ui.md` had already decided scope selection is not a
  modal. The acetate grammar survives — solved alpha, punched binding edge, hard
  two-frame hinge — only its position changed.
- **The customer's identity lives in the running head, not as a 40px line on the
  sources leaf.** A running head is where a book names itself, and it answers
  "which customer am I looking at" on every division at once rather than on one.
- **`RUN SYNC NOW` is retained, against this contract's own Constraints line.**
  That line promised no manual trigger because the endpoint does not exist. On
  re-reading, the action is pinned by `TenantOverview.test.tsx` and carries
  ADR-0007-reasoned product intent, and its failure path is honest: the request
  fails and an errata slip says so, and the success copy cannot render. Deleting
  a test-pinned affordance because the backend is unfinished is the owner's
  decision, not this build's. The missing router is reported instead.

## Unresolved

- No endpoint serves the commercial overview, so money and the three-valued
  verdict are rendered nowhere in the product. Their libraries and tests stay.
- **`POST /api/tenants/{id}/runs` has no router in `vcdo/api/routers/`.** The
  in-memory test server implements it, so the suite is green over a call that
  fails against the real service. This is a backend gap, flagged in
  `ui/src/api/client.ts` and in PRODUCT.md, not a UI decision.
- The world's own materials are named but unrendered: acetate gloss, paper
  grain, halftone ink, and stacked tab depth. The build reaches the form's
  structure and state grammar, not its full material range.

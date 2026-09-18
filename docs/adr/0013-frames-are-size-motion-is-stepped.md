# 13. Frames are size, and nothing eases

- Status: Accepted
- Date: 2026-09-18

## Decision

The control plane has **four motion tokens instead of one**, and the number of frames in a
token is **the size of the thing that moved**:

| Token     | Frames                | What moves                                             |
| --------- | --------------------- | ------------------------------------------------------ |
| `--hinge` | `90ms steps(2, end)`  | a part: a plate, a punch, an input rule, a tab         |
| `--tip`   | `150ms steps(3, end)` | a loose slip laid onto the page: errata, a status note |
| `--turn`  | `190ms steps(4, end)` | a whole leaf, turning about its spine                  |
| `--pass`  | `120ms steps(2, end)` | nothing. Ink going down in passes of the press         |

Every one of them is `steps(n, end)`. **There is no `cubic-bezier` anywhere in
`apps/ui/src/index.css`**, and that remains the rule this ADR extends rather than relaxes.

The authored moment is **the page turn**: `.leaf` rotates 5° about `left center` under a
1600px perspective and lands flat, in four frames. `Book.tsx` keys the leaf to
`` `${tenantId}/${current}` `` so it fires when the division changes and when the customer
changes, and does not fire for a panel hinging open inside the section it already belongs
to.

Six supporting states join it, each at the tier its object belongs to: an errata slip and a
status note are **tipped in** slightly crooked and land square (`--tip`); a schedule or table
row **inks in** when it is new (`--pass`); the open tab's selection hole is **punched** in one
stroke (`--hinge`); a struck plate travels 1px down (`--hinge`); the row wash under the cursor
now changes in the hinge's two frames instead of cutting; and the sign-in step is keyed so
asking for the code is a slip arriving rather than a form edited in place.

`.book` takes `overflow-x: clip` — a leaf mid-turn is tipped toward the reader and projects a
few per cent wider than the page it lands on.

## Why

- **One token stopped describing one thing.** `--hinge` was introduced for a hinged panel and
  was then spent on plates, inputs, punches and the progress rule, because it was the only
  token there was. At that point the name had stopped being true and the value had stopped
  carrying information: everything in the interface moved at exactly the same rate whether it
  was a checkbox or a page.

- **Frames can carry meaning for free, and this design already does this trick.** Ply is rank;
  shape is state before hue is; lettering is solved per board. A stepped system has a variable
  an eased one does not — the frame count is directly visible, and a reader who has seen two
  tiers can size the third without being told. Choosing durations by taste would have thrown
  away the one expressive axis that stepping buys.

- **The book's defining gesture was the thing it never did.** The whole navigation is a tab
  strip on a ring binder. Opening a division replaced the page instantly, which is what a
  screen does and not what a book does, so the metaphor was carried entirely by static
  drawing — punch holes, a spine, a fore edge — and contradicted the moment anyone used it.

- **Motion is the only channel some of these states had.** An errata slip carries
  `role="alert"`, so a screen reader is told it arrived; a sighted reader was told nothing,
  and a slip already on the page when it opened looked identical to one that appeared while
  they were reading. The same gap sat on the sign-in step change, which is the one moment that
  screen exists to communicate.

- **A new row is the signal; a staggered list is not.** Rows are reconciled by key, so an
  existing row does not remount and does not re-ink. Withdraw an invitation and the remaining
  rows sit still; send one and exactly one line is laid down. A stagger would have spent that
  on every row moving on every fetch.

## What this rejects

- **Easing, at every tier.** `cubic-bezier(0.16, 1, 0.3, 1)` is the reflex answer for a
  confident arrival and would have made all seven of these feel like a competent modern web
  app, which is precisely the failure: the surface would have stopped being a printed object
  the moment it moved. Stepping is not a stylisation of easing, it is the claim that this
  thing is moved rather than animated.

- **Motion on scroll.** Nothing here reacts to scroll position. This is an Operate surface;
  the reader is reading a schedule of standing authorities, not being walked through a
  narrative.

- **A motion library.** All seven are CSS keyframes or transitions on `transform` and
  `opacity`. Nothing needed interruption, sequencing or a dynamic value, so nothing needed
  Framer Motion or the Web Animations API.

- **A stagger on lists.** Argued above. It is the effect that looks most like craft and
  destroys the one piece of information the row animation actually carries.

## Reduced motion

`prefers-reduced-motion: reduce` collapses `--hinge`, `--tip` and `--turn` to a single frame,
switches the leaf turn and the punch off, and swaps the slip's keyframes for the ink pass —
so a slip still lays itself down, it simply does not arrive from above or land crooked.

`--pass` is **deliberately untouched**. It is opacity, nothing travels in it, and a row that
inks in is how a reader learns that row is new. Reducing it too would have read the preference
as "tell me less" rather than "move me less", which is what the setting actually asks.

## Consequences

- A new transition picks its tier by asking what size the thing is, not how important it feels.
  A part may not borrow the leaf's four frames.
- `--hinge` keeps its name and its value, so nothing that already used it changed.
- The no-easing rule is now stated in the sheet's header docstring as well as at the tokens,
  because it is the constraint most likely to be "simplified" away by a later pass reaching for
  a familiar curve.
- Where `overflow-x: clip` is unsupported the axis falls back to `visible` and a turning leaf
  can briefly overhang the binder. That is a 190ms cosmetic overflow; `hidden` was rejected
  because it computes the other axis to `auto` and would move the document's scroll inside
  `.book`.

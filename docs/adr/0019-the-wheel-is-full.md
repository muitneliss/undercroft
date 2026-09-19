# 19. The wheel is full: seven divisions take the seven hues, and an eighth is a new decision

- Status: Accepted
- Date: 2026-09-19
- Qualifies: [ADR 0012](0012-the-tab-strip-crosses-the-head.md), which bound four divisions
  and left three hues of the seven-hue wheel unspoken for

## Decision

The book has seven divisions, bound in ring order — Customers, Sources, Journal, Raw lake,
Models, Reports, People — and each takes the next hue of the wheel in the wheel's own declared
order: the Journal is grass, Models violet, Reports sienna. Vermilion stays held out for the
errata slip and nothing else. No hue is left unspoken for. The three new divisions are sections
of one customer's book, like Sources, so they are scoped and render face-down until a customer
is chosen; the two that are not yet printed (Models, Reports) are unprinted leaves rather than
absent tabs, because a tab that appears later teaches nobody that the section was coming.

## Why

The three are the three stages of the ring the product was missing: seeing that a run happened
(Journal), shaping the data that landed (Models), and reading it (Reports). Taking hues in the
wheel's order rather than choosing one per section is what keeps hue meaning "which division"
and nothing else — the same reason ADR 0010 gives for the mark being one ink — and it is why a
new section is a decision about the wheel before it is a route. `acetate.test.ts` walks every
hue and proves the reading field clears its contrast target on each; `divisions.test.ts` pins
that the seven are distinct and that none of them is the errata's.

## What it costs

An eighth division has no hue, and that is the point rather than an oversight: a wheel with
room in it was a promise the system made, and this ADR records the moment the promise was
spent. The next section either replaces one of these seven or opens a second wheel with its
own acetate solve and its own contrast proof, and either is a new ADR. Seven upright tabs also
crowd the strip between roughly 760 and 1300 px under the Vietnamese labels; if a label breaks,
the fix is a shorter name, not a smaller wheel.

---
title: 'ADR 0019: the wheel is full'
type: source
date: 2026-09-19
tags: []
source: docs/adr/0019-the-wheel-is-full.md
source_path: docs/adr/0019-the-wheel-is-full.md
source_hash: 68fbf595554de850f1842b3ded4a9d17aae108c2fb7680bd896dbb4ed7e8d70d
ingested: 2026-09-19
---

# ADR 0019: the wheel is full

The seven-hue section wheel is now fully spoken for: the book has seven divisions bound in ring order (Customers, Sources, Journal, Raw lake, Models, Reports, People), and the three new ones take the next hues in the wheel's declared order, Journal grass, Models violet, Reports sienna. Vermilion stays held out for the errata slip. The new divisions are scoped to one customer's book and render face-down until a customer is chosen; Models and Reports are unprinted leaves rather than absent tabs so the section is visible before it is printed.

Hues are taken in wheel order rather than chosen per section so that hue keeps meaning "which division" and nothing else. `acetate.test.ts` proves every hue clears the reading-field contrast target and `divisions.test.ts` pins seven distinct hues, none of them the errata's.

The cost: an eighth division has no hue. The next section either replaces one of the seven or opens a second wheel with its own contrast proof, and either is a new ADR. Seven upright tabs also crowd the strip between about 760 and 1300 px under Vietnamese labels; a label that breaks gets a shorter name, not a smaller wheel.

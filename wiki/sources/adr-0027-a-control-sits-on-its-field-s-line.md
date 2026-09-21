---
title: ADR 0027 A Control Sits on Its Field's Line
type: source
date: 2026-09-21
tags: []
source: docs/adr/0027-a-control-sits-on-its-fields-line.md
source_path: docs/adr/0027-a-control-sits-on-its-fields-line.md
source_hash: 7639ad7f1fa80878cf4bbf1b61c7ca4e6bbff7a36c08e4caa75d2d569746546c
ingested: 2026-09-21
---

# ADR 0027 A Control Sits on Its Field's Line

A `.row` that carries a labelled `.field` aligns its items to the field's **bottom edge**, not to the row's centre, and the plate beside the field is struck to the input's height via a `--control-h` token. `.row` centres its items, which is right for a row of plates and wrong the moment one item is a field -- a caption stacked on a box -- because centring hangs the button that submits it half a caption above the box it acts on. It renders, typechecks and passes every other test while doing it, which is why it shipped on seven bands (the lake's search band among them) before anyone said so.

Two halves carry the decision and are written as one declaration block in `apps/ui/src/index.css`. `.row--field` is what an author writes, and `.ast-grep/rules/row-field-alignment.yml` refuses a `.field` written as a child of a bare `.row` and names the class in the failure -- a hard gate in `bun run lint:rules`, and so in `bun run verify` and CI. `.row:has(> .field)` is the net under it, for the field that arrives from a child component (`ChartOptions`) or out of a `.map` (`QuestionBands`), where no linter can follow the markup but CSS reads the tree the browser built.

Both halves are pinned from both sides, as [[ADR 0011 Layers Are Directories, Handler to Service to Repo]]'s rules and the `no-usestate` rule already are. `scripts/alignment.test.ts` runs the real `ast-grep` binary over fixtures where the rule must fire (a field child, including the self-closing spelling) and stay quiet (`row--field`, a row of plates, a `.field__hint` that is a paragraph), and asserts that every block naming `.row--field` names the `:has` net too, so the pair cannot drift. `apps/ui/src/layout.test.ts` injects the real stylesheet into happy-dom and asks for the computed value, unwrapping `@layer undercroft` first because happy-dom's CSSOM drops the layer whole.

The rule is deliberately narrow -- only a `.field` written as a literal child -- because a rule wide enough to catch a field behind a component would flag every row and be switched off within a day. The `:has` net is what lets it stay narrow. Asserting the net through happy-dom was rejected: its selector engine does not implement `:has()` at 15.11.7, so such a test would pass by accident, and geometry cannot be measured at all in an offline gate with no layout engine.

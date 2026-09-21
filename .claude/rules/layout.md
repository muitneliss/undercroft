---
description: A control sits on the line of the field beside it; .row--field, not a centred .row
globs: ["apps/ui/**/*.tsx", "apps/ui/**/*.css"]
---

# A control sits on its field's line

`.row` centres its items. That is right for a row of plates, all one height, and wrong the
moment one item is a `.field` — a field is a caption stacked on a box, so centring hangs the
button that submits it half a caption **above** the box it acts on. It renders, it
typechecks, every test passes, and it reads as two objects that missed each other. It shipped
that way on seven bands, which is why it is a gate now and not a habit. ADR 0027.

## NEVER

- **NEVER put a `.field` in a bare `.row`.** Write `className="row row--field"`: the row then
  aligns to the field's bottom edge and the plate beside it is struck to the input's height.
  Enforced — `.ast-grep/rules/row-field-alignment.yml` fails `task ci:lint-rules`
  (`bun run lint:rules`), and therefore `bun run verify` and CI.
- **NEVER fix an alignment at the call site**, with an inline style, a one-off wrapper, or a
  margin that happens to cancel the offset. The composition is what is wrong, so the sheet is
  where it gets answered; a call-site patch leaves the next row to be written wrong again.
- **NEVER hard-code a control's height.** `--control-h` is the input's own height solved once,
  and it is what makes a plate and the box beside it one object rather than two that nearly
  line up.

## Follow

- **`.row--field` and `.row:has(> .field)` are one declaration block**, and stay one. The class
  is what an author writes and a linter can see; the `:has` selector is the net under it, for a
  field that arrives from a child component or out of a `.map`. Two blocks would be two answers
  to one question, and they would drift — `scripts/alignment.test.ts` fails if they separate.
- **Write the class even where the net would carry it.** `ChartOptions` and `QuestionBands`
  both render their fields one component or one `.map` deep, so the rule cannot see them; they
  say `row row--field` anyway, because the markup should state which kind of row it is.
- **A new layout primitive that can hold a field decides about fields when it is written**, not
  the first time somebody notices. Both guards are pinned from both sides — the rule fires and
  stays quiet in `scripts/alignment.test.ts`, the class resolves to `flex-end` off the real
  stylesheet in `apps/ui/src/layout.test.ts`.

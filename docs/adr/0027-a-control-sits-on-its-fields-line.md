# 27. A control sits on its field's line, and a linter says so

- Status: Accepted
- Date: 2026-09-21

## Decision

A `.row` that carries a labelled `.field` aligns its items to the field's **bottom edge**, not
to the row's centre, and the plate beside the field is struck to the input's height so the two
read as one control. This is `.row--field` in `apps/ui/src/index.css`, together with a
`--control-h` token (the input's own height, solved once) that both the input and the plate
take as a `min-height`. `.plate--small` is deliberately excluded: it is small on purpose, and
bottom alignment already puts it on the same line.

Two things carry the decision, and they are written as one declaration block:

- **`.row--field`** is what an author writes. `.ast-grep/rules/row-field-alignment.yml` refuses
  a `.field` written as a child of a bare `.row` and names the class in the failure, so the
  markup has to say which kind of row it is. It fails `task ci:lint-rules`
  (`bun run lint:rules`), and therefore `bun run verify` and CI.
- **`.row:has(> .field)`** is the net under it, for the field that arrives from a child
  component (`ChartOptions`' four selects) or out of a `.map` (`QuestionBands`' parameters),
  where the class list in the file says `row` and the DOM still ends up with a field in it. No
  linter can follow that; CSS can, because it reads the tree the browser actually built.

Both halves are pinned from both sides. `scripts/alignment.test.ts` runs the real `ast-grep`
binary over fixtures where the rule must fire (a field child, including the self-closing
spelling) and where it must stay quiet (`row--field`, a row of plates, a `.field__hint` that
is a paragraph and not a field), and asserts that every block naming `.row--field` names the
`:has` net too, so the pair cannot drift. `apps/ui/src/layout.test.ts` injects the real
stylesheet into happy-dom and asks for the computed value: `.row` still centres a row of
plates, `.row--field` resolves to `flex-end`, and the input and the plate come out one height.

## Why

- **The defect ships looking deliberate.** `.row` centres its items, which is right for a row
  of plates and wrong the moment one item is a field — a field is a caption stacked on a box,
  so centring hangs the button that submits it half a caption above the box it acts on.
  Nothing raises, nothing logs, `tsc` is happy and every test passes; the page just reads as
  two objects that missed each other. It shipped on the lake's search band and on six other
  bands before anyone said so, which is the argument for a machine rather than a convention.
- **It is the composition, not the site, that is wrong.** Seven places had it, and fixing seven
  call sites without fixing the class they share would have left the eighth to be written next
  week. The fix is in the sheet; the call sites only declare which kind of row they are.
- **The rule is narrow on purpose.** It only sees a `.field` written as a literal child, which
  is exactly where a reader could have seen it too and where a machine can prove it without
  guessing. Widening it to "a row containing any component that might render a field" would
  flag every row in the app and be switched off within a day — the failure mode ADR 0011's
  layering rules already record. The `:has` net covers what the narrow rule cannot, so the rule
  does not have to be wide to be safe.
- **A computed value is evidence; a string in a stylesheet is not.** `layout.test.ts` asks
  happy-dom what `align-items` resolves to, so a `.row--field` that is present but overridden
  later in the sheet fails. The layer body is unwrapped before injection because happy-dom's
  CSSOM drops `@layer` whole — the same declarations, one nesting level up.

## Rejected

- **Fixing only `LakeSearch`**, the band the misalignment was reported on. Rejected: six other
  bands had the identical pairing, and the next one written would have had it again.
- **`align-items: flex-end` on `.row` itself.** Rejected: `.row` is the generic row and most of
  its uses are plates and chips of one height, where centring is what is meant; changing the
  primitive to fix one composition changes every row in the app with no way to review the
  result.
- **The `:has` net alone, with no class and no lint.** It fixes every case, including the ones
  a linter cannot see, and it was the first draft. Rejected as the whole answer because the
  user's ask was a hard gate, and because a net nobody can see in the markup is a rule the next
  author never learns — they write `row`, it happens to work, and the day the net is deleted
  every one of those rows quietly goes back to being wrong.
- **The lint alone, with no net.** Rejected for the mirror reason: it is blind to a field that
  arrives through a component or a `.map`, which is two of the seven sites found. A gate that
  misses two in seven teaches readers that passing it means something it does not.
- **Asserting the alignment by rendering the real components and measuring geometry.** There is
  no layout engine in the offline gate (`bun run verify` must pass with no Docker, no network),
  and happy-dom computes style but not boxes. Computed `align-items` and `min-height` are what
  can honestly be asserted, and the ADR records that limit rather than implying more.
- **Asserting the `:has` net through happy-dom too.** Its selector engine does not implement
  `:has()` at 15.11.7 — `document.querySelectorAll(".row:has(> .field)")` returns nothing for
  markup that matches. A test written against it would pass by accident and fail to fire when
  the net broke, so the net is pinned structurally instead.

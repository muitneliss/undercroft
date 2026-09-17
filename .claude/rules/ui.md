---
paths:
  - "ui/**"
---

# The control plane UI

This is the repo's first non-Python code, and the reason it needs its own rule
file is narrow: **none of the existing rules load here.** `tests.md` is scoped to
`tests/**/*.py`, `data-integrity.md` to `vcdo/**/*.py`. The disciplines they
carry still apply — they simply have to be restated in a file whose glob matches
TypeScript, or they silently stop applying at the language boundary.

## NEVER

- **NEVER turn a monetary amount into a `number`.** No `Number(...)`, no
  `parseFloat`, no unary `+`, no `JSON.parse` into an arithmetic path.
  JavaScript's only numeric type is a float, and `data-integrity.md` forbids
  floats for money. Amounts arrive as strings and stay strings; format them with
  `formatMoney()` from `@/lib/money`. An ESLint rule enforces this — if it fires,
  the rule is right.
- **NEVER render a missing value as `0` or as blank.** `null` means "no value
  recorded". A zero is a claim; an empty cell reads as a layout bug. Use
  `MISSING` (an em dash).
- **NEVER collapse `unverified` into a pass or a failure.** It is a third
  outcome: we had nothing to compare against. Rendering it as a muted "ok" says
  we checked and it passed; rendering it as a warning says we checked and it
  failed. Use `presentVerdict()`, which has an exhaustive switch so a fourth
  state is a compile error rather than a blank badge.
- **NEVER mock.** No `vi.mock`, `vi.fn`, `vi.spyOn`, no asserting a function was
  called. Same reason as `tests.md`: a suite that asserts a mock was called is
  green whether or not the code works.
- **NEVER put a real client name in a fixture, a story or a screenshot.**
  `pii.md` applies here in full; its `*.md` glob does not reach this directory,
  but the rule does.

## Follow

- **Tests run against the in-memory API in `src/test/server.ts`**, which is a
  working implementation backed by `src/test/store.ts` and enforces the same
  authorisation rules the real service does — including returning 404 for a
  tenant you cannot see. Extend it rather than adding a handler that always
  answers; a fake that never refuses makes a broken boundary look fine.
- **Assert on what a person would see.** Roles and text, not class names or
  component internals.
- **Unhandled requests are an error, not a warning** (`onUnhandledRequest:
  "error"`). A component calling an endpoint nobody modelled must fail loudly
  here rather than quietly rendering an empty state that looks deliberate.
- **Every interactive element gets its states**: default, hover, focus, active,
  disabled, loading, error. Shipping half of them is how a control plane becomes
  unusable under latency.
- **Status is never carried by colour alone** (WCAG 2.1 AA 1.4.1). A badge
  carries a glyph and a word as well as a tone.
- **Skeletons, not spinners, inside content.** The shape of what is coming keeps
  the layout from jumping.
- **Exhaust inline and progressive alternatives before a modal.** Scope
  selection is a side panel for that reason.

## The consent surface

Connecting a source asks someone to hand over read access to their company email
or their accounting system. What will be read, that nothing will be written, and
that it can be undone are stated **on the card, before the redirect** — not on a
help page. `ConnectionCard.test.tsx` pins that copy. If a redesign drops it as
clutter, those tests are the objection.

## The gate

`make verify` runs `ui-lint` and `ui-test` alongside ruff and pytest. It is one
gate with one definition; do not add a second entry point. The targets **fail
loudly when Bun is missing** rather than skipping, because a check that passes
because its toolchain is absent is worse than no check.

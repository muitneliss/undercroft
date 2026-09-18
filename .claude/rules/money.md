---
description: Money is a string, and the platform never guesses
globs: ["packages/**/*.ts", "apps/**/*.ts", "apps/**/*.tsx", "dbt/**/*.sql"]
---

# Money, and never guessing

Both rules below fail _silently_ — a wrong number and a guessed identity do not raise;
they arrive in a dashboard looking exactly like facts. JavaScript makes the first one
sharper than most languages: its only numeric type is a float.

## NEVER

- **NEVER put a monetary amount in a `number`.** No `Number()`, no `parseFloat`, no unary
  `+`, no `JSON.parse` into arithmetic, no `Big#toNumber()`. Enforced repo-wide by
  `.biome/plugins/money.grit` and by `noRestrictedGlobals` in `biome.jsonc`; if it fires,
  the rule is right.

  `Number.parseInt` is the one spelling deliberately left alone: a port or a key version is
  an integer index, not an amount, and Biome's `useNumberNamespace` rewrites the bare global
  into exactly that form. The plugin's docstring records why banning both spellings of one
  function is a contradiction rather than extra strictness.

- **NEVER default an unreadable amount to `0`.** A zero is indistinguishable from a real
  zero downstream. An unreadable amount is `null` (`parseAmount` returns it) or a NULL
  column (`parse_amount` in dbt).
- **NEVER convert between currencies implicitly.** No ambient default. Conversion is an
  explicit step through a dated rate.
- **NEVER treat "no evidence" as "pass".** The absence of a mismatch is not a match;
  `compare` returns `unverified`, and it must not be collapsed into `ok` or `mismatch`.

## Follow

- **`big.js` end to end**, `numeric(18,4)` in Postgres, `ROUND_HALF_UP`.
- **Money is a string at every boundary** — wire, DB, JSON. `pg` numeric/int8 parsers are
  pinned to strings and asserted by a test.
- **Amounts carry their currency**; two in different currencies are not comparable.
- **Render with `formatMoney`**, which truncates rather than rounds and shows `MISSING`
  (an em dash) for `null`, never `0`.

See `packages/core/src/money.ts`; its docstring records the legacy failures these rules
exist to prevent.

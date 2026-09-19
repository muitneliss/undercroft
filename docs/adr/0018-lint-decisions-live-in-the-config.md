# 18. A lint decision lives in the config, not in 679 file headers

- Status: Accepted
- Date: 2026-09-19
- Supersedes: the "no rule is disabled in `biome.jsonc`" paragraph of
  [ADR 0012](0012-biome-replaces-eslint-and-prettier.md), and extends
  [ADR 0017](0017-tests-are-a-category-in-the-lint-config.md) from test files to every file

## Decision

`preset: "all"` stays. What changes is where a rule that cannot hold is answered.

1. **`domains` names the four frameworks this repo actually uses** — `project`, `react`,
   `test`, `types` — and the other eleven are `none`.
2. **A rule that cannot hold anywhere is switched off in `biome.jsonc`**, once, with its
   reason beside it.
3. **A rule that cannot hold at a handful of named places is a path entry** in `overrides`,
   so it stays on for every file not listed.
4. **`biome-ignore-all` is banned outside test files**, by
   `.ast-grep/rules/no-biome-ignore-all.yml`, which fails `bun run lint:rules`.
5. **`// biome-ignore-all lint:` and `lint/plugin:` are banned everywhere**, test files
   included, because both silence the money and no-mock plugins.
6. **`bun run lint` gains `--error-on-warnings`**, so the one suppression form still allowed —
   the line-level `// biome-ignore` — fails the gate once Biome reports it unused.

ADR 0012 reasoned that "a blanket `off` in the config is invisible at the code it affects; a
`biome-ignore-all` is not". That is true and it is not the whole trade, which is what the
measurements below settled.

## Why

**A header is a permit for the whole file, not for the line that needed one.** The header in
`packages/connector-runtime/src/fetcher.ts` explains that `noMagicNumbers` is off for "slice
offsets, the radix argument, padStart widths". Appending an unrelated function returning
`86_400 * 37` to that file left `bun run lint` green. Every one of the 679 headers had that
property.

**Biome never reports a `biome-ignore-all` that has stopped being needed.** It does report an
unused line-level `// biome-ignore` (`suppressions/unused`). Verified against 2.5.14 on an
isolated fixture: the line form is reported, the file form is not. So ADR 0012's promise —
"a reviewer can check each one and delete it when it stops being true" — had no machine
behind it, and **17 of the 679 were already dead** with the gate green. All seven
`useQwikValidLexicalScope` headers were dead; the rule never fires in this repo at all.

**Most of the headers were not decisions about the code, they were the cost of `domains: all`.**
Of the 1,377 findings the headers were hiding in non-test files, **255 came from frameworks
this repo does not use**, and 196 of those were one rule: `noReactSpecificProps`, a Solid
rule whose fix rewrites `className` to `class`. ADR 0012 records that autofix breaking `tsc`.
Switching eleven domains off costs no coverage — a Solid rule only ever fires on Solid code —
and it removed 255 findings and ~55 headers without touching a line of source.

**Two spellings reach past the plugins.** `money.grit` and `no-mocks.grit` are, per CLAUDE.md,
the two rules this repo most needs a machine to enforce. Measured against 2.5.14:
`// biome-ignore-all plugin:` does **not** silence them, but `// biome-ignore-all lint:` and
`// biome-ignore-all lint/plugin:` both do. No file in the tree used either spelling — the
hole was open, not used — and rule 5 closes it.

## What it cost

1,377 findings in non-test files. 524 headers deleted, plus 8 written as CSS/SVG block
comments. Roughly 190 were fixed as code and the rest are answered in the config:

| answered how                          | findings |
| ------------------------------------- | -------- |
| eleven domains switched off           | 255      |
| off repo-wide, with a reason each     | ~700     |
| path-scoped to the files that earn it | ~90      |
| fixed in code                         | ~190     |

The code fixes are the part worth naming, because they are what the exercise was for: every
regex literal hoisted to module scope and named; return types on 23 functions; `useId()` in
place of seven hardcoded element ids; `isRecord` guards replacing four unsafe assertions;
`instanceof Error` replacing `(error as Error)`; causes threaded through `ObjectNotFound` and
`SpecError`; `assertNever` defaults on two exhaustive switches; and two dead re-exports
removed from `handlers/server.ts`.

**One rule was switched off because it is wrong, not because it is opinionated.**
`noUnnecessaryConditions` reports the null guard after `DECIMAL.exec(amount)` in
`apps/ui/src/lib/money.ts` as "always falsy". Delete that guard and `tsc` answers
`TS18047: 'match' is possibly 'null'`. Biome's inference engine is nursery-grade and disagrees
with `tsc`; `tsc` is the check that binds. Reconsider on a Biome upgrade.

**Two things are deliberately left undone**, recorded here rather than hidden:

- `packages/crypto/src/seal.ts` defaults its `env` parameter to `process.env`, so a caller
  that forgets gets ambient configuration in a package below every layer. The fix is to make
  `env` required and thread it from the two call sites in `packages/db/src/repos/connections.ts`
  up to the composition roots — a cross-package API change, not a lint edit.
- Twelve files assert a shape onto `JSON.parse` / `response.json()` / the YAML reader. Each
  narrows or checks immediately afterwards, and the better answer is a Zod schema at each
  boundary, which `@undercroft/contracts` already provides for the lake's own request bodies.
  That changes what the code **checks**, so it is not folded into a lint pass.

## Rejected

**Convert all 679 to line-level `// biome-ignore`.** This is the purist reading and Biome can
even write them (`lint --write --suppress`). It produces ~1,616 inline comments across 165
files, and the generated reason is one sentence repeated — which is precisely the disease
ADR 0017 cured at 137-header scale. Two findings could not be converted at all:
`useFilenamingConvention` is anchored at line 0, where no comment can precede it.

**Keep the headers and add an inventory file** listing every surviving `(file, rule)` pair,
failing the gate on a new or dead entry. It would have worked and it needs no code changes,
but it keeps a second copy of a list that `biome.jsonc` can hold directly, and a header still
permits the whole file.

**Leave `domains: all` and suppress.** This is the status quo ADR 0012 chose. It is what
taught readers to skip suppression headers: after the 196th `noReactSpecificProps`, nobody
reads the 197th, and the 17 dead ones prove nobody did.

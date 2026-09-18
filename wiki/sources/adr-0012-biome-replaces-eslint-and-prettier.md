---
title: ADR 0012 Biome Replaces ESLint and Prettier
type: source
date: 2026-09-18
tags: []
source: docs/adr/0012-biome-replaces-eslint-and-prettier.md
source_path: docs/adr/0012-biome-replaces-eslint-and-prettier.md
source_hash: 69bd5096cef40c3ce620e5b616ce9a640b733edb1b39cac84da7cc26cb7ec873
ingested: 2026-09-18
---

# ADR 0012 Biome Replaces ESLint and Prettier

## Decision

**Biome is the linter and the formatter.** ESLint, `@eslint/js`, `typescript-eslint` and
`eslint.config.js` are removed. Prettier stays, narrowed by `.prettierignore` to Markdown and
YAML — the two languages Biome cannot format — so no file has two formatters.

The linter runs at maximum strictness, literally: `"rules": { "preset": "all" }` enables all
554 rules Biome ships, including nursery, with per-group `"error"` entries escalating the ones
whose default severity is `info` or `warn`, because a warning that never fails the gate is a
rule nobody fixes. All fifteen `domains` are on.

**No rule is disabled in `biome.jsonc`.** Where a rule cannot apply it is suppressed at the
file it applies to, with the reason written beside it. A blanket `off` in the config is
invisible at the code it affects; a `biome-ignore-all` is not.

Three rules take options rather than a bare severity, in an `overrides` entry:
`noRestrictedImports`, `noRestrictedGlobals`, and `useConsistentFunctionStyle` pointed at
`style: "declaration"` (which took it from 261 findings to 16 real ones).

## Why

ESLint's config here was small but load-bearing: mostly `no-restricted-syntax` carrying
`.claude/rules/money.md` and `.claude/rules/tests.md` — the two rules whose failure is
**silent**, where a wrong amount or a green-but-meaningless suite does not raise, it just
looks like a fact. Moving off ESLint meant reproducing those or losing them.

**Biome ships no `no-restricted-syntax`.** Its replacement is GritQL plugins, which proved
enough: `.biome/plugins/money.grit`, `no-mocks.grit` and `ui-server-import.grit` carry every
ban the ESLint config did, with the same messages. The third exists because Biome's
`noRestrictedImports` has `importNames` and `allowImportNames` but no `allowTypeImports`, and
the UI must be able to say `import type { AppRouter }` while a value import — which would
bundle `pg` and the secret-key loader into the browser — stays refused.

Type-aware linting survives: Biome's `types` domain carries `noFloatingPromises`,
`noMisusedPromises` and `noUnsafeTypeAssertion` across from `recommendedTypeChecked`. The
`project` domain adds module-graph rules ESLint did not have; `noUnresolvedImports` caught a
fixture importing an export that does not exist.

Reformatting the whole repo under Biome's formatter, configured from the old `.prettierrc`,
moved two files — so this is not a change of style.

## What it cost

Turning everything on produced **2,366 findings**; roughly 1,500 were resolved by fixing the
code and the remainder suppressed with reasons. Three non-obvious hazards:

* **Biome's *safe* autofix can be destructive here.** `noReactSpecificProps` is a Solid rule
  whose fix rewrites `className` to `class`, which does not compile in React — it broke `tsc`
  on the first run. `noInlineStyles` is worse: its fix **deletes** the attribute rather than
  relocating it, removing the tab rail's `flexGrow`, which is the proportional sizing the rail
  exists to show (see [[ADR 0012 The Tab Strip Crosses the Head]]).
  `useSingleJsDocAsterisk` flattened the bullet list recording how invite-only is enforced in
  three places. `noConsole` deleted the worker's startup line.
* **Whole domains do not apply.** Solid, Qwik and React Native rules fire on a React DOM app
  and can only be suppressed; `noNodejsModules` and `noBunModules` fire on server code and on
  a suite that runs on Bun's own test runner. The price of `domains: all`, paid knowingly.
* **A rule can contradict another.** The ESLint config banned `Number.parseInt` and allowed
  the bare global `parseInt`; Biome's `useNumberNamespace` rewrites the bare global **into**
  `Number.parseInt`, so porting the ban verbatim banned both spellings of one function and
  flagged 14 correct call sites. The ban now covers `Number()` and `parseFloat` only.

## Rejected

* **Keeping ESLint alongside Biome.** Two linters means two definitions of green — the same
  objection `CLAUDE.md` makes to a second runtime — and it leaves the slowest tool in the gate.
* **Dropping Prettier entirely.** Biome 2.5 formats neither Markdown nor YAML; dropping it
  would silently stop format-checking 37 `.md` and 18 `.yaml` files, including `docs/adr/` and
  the CI workflows.
* **`preset: "recommended"` plus a curated list.** The comfortable answer, and it makes
  strictness a matter of taste that drifts at every review. Everything on, with each exception
  written where it applies, is auditable: `grep biome-ignore` lists the whole of it.
* **Moving the money bans to ast-grep**, which the repo already runs for the `layer-*` rules
  (see [[ADR 0011 Layers Are Directories, Handler to Service to Repo]]). Rejected only because
  the messages belong next to the linter a developer already sees in their editor. If GritQL
  plugins prove unstable, this is the fallback.

## Notes for the next upgrade

Two Biome 2.5.14 behaviours are worked around and should be re-tested:

* A regex **capture group** in a GritQL pattern is read as a variable binding and the plugin
  refuses to load — quietly. Use `(?:...)`.
* A plugin registered as `{ "path": ..., "includes": [...] }` deserialises without complaint
  and then never runs, on any file. `ui-server-import.grit` therefore scopes itself with
  `$filename`.

Both failures are invisible in a clean run, which is why `scripts/biomePlugins.test.ts` pins
each plugin from both sides — one fixture where it fires, one where it stays quiet.

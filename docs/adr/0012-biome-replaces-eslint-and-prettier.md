# 12. Biome replaces ESLint and Prettier, with every rule on

- Status: Accepted
- Date: 2026-09-18

## Decision

**Biome is the linter and the formatter.** ESLint, `@eslint/js` and `typescript-eslint` are
removed, along with `eslint.config.js`. Prettier stays, narrowed to Markdown and YAML.

The linter runs at maximum strictness, and that phrase is meant literally:

```jsonc
"rules": { "preset": "all", "a11y": "error", ..., "suspicious": "error" },
"domains": { "astro": "all", ..., "vue": "all" }
```

`preset: "all"` enables all 554 rules Biome ships, including nursery. The per-group `"error"`
entries escalate the ones whose default severity is `info` or `warn`, because a warning that
never fails the gate is a rule nobody fixes. All fifteen domains are on.

**No rule is disabled in `biome.jsonc`.** Where a rule cannot apply, it is suppressed at the
file it applies to with the reason written beside it, so a reviewer can check each one and
delete it when it stops being true. A blanket `off` in the config is invisible at the code it
affects; a `biome-ignore-all` is not.

Two rules are given OPTIONS rather than a severity, in an `overrides` entry, because a group
set to a bare severity has nowhere to put them: `noRestrictedImports` and
`noRestrictedGlobals`. One more, `useConsistentFunctionStyle`, is pointed at
`style: "declaration"` — it enforces consistency rather than one spelling, and the repo is
consistent on declarations. That took it from 261 findings to 16 real ones.

## Why

ESLint's config here was small but load-bearing. Most of it was `no-restricted-syntax`
carrying `.claude/rules/money.md` and `.claude/rules/tests.md` — the two rules whose failure
is silent, where a wrong amount or a green-but-meaningless suite does not raise, it just
looks like a fact. Moving off ESLint meant either reproducing those or losing them.

**Biome ships no `no-restricted-syntax`.** Its replacement is GritQL plugins, which turned
out to be enough: `.biome/plugins/money.grit`, `no-mocks.grit` and `ui-server-import.grit`
carry every ban the ESLint config did, with the same messages. The third exists because
Biome's `noRestrictedImports` has `importNames` and `allowImportNames` but no
`allowTypeImports`, and the UI must be able to say `import type { AppRouter }` while a value
import — which would bundle `pg` and the secret-key loader into the browser — stays refused.

Type-aware linting survives the move. `typescript-eslint`'s `recommendedTypeChecked` was the
other thing worth keeping, and Biome's `types` domain runs an inference engine that carries
`noFloatingPromises`, `noMisusedPromises` and `noUnsafeTypeAssertion` across. The `project`
domain adds module-graph rules ESLint did not have — one of which, `noUnresolvedImports`,
caught a fixture importing an export that does not exist.

Formatting is not a change of style: reformatting the whole repo under Biome's formatter,
configured from the old `.prettierrc`, moved two files.

## What it cost, honestly

Turning everything on produced **2,366 findings**. Roughly 1,500 are resolved by fixing the
code; the remainder are suppressed with reasons. Three things are worth recording because
they are not obvious:

- **Biome's _safe_ autofix can be destructive here.** `noReactSpecificProps` is a Solid rule;
  its fix rewrites `className` to `class`, which does not compile in React. It broke `tsc` on
  the first run. `noInlineStyles` is worse: its fix DELETES the attribute rather than
  relocating it, which removed the tab rail's `flexGrow` — the proportional heights the rail
  exists to show. `useSingleJsDocAsterisk` flattened the bullet list recording how invite-only
  is enforced in three places. `noConsole` deleted the worker's startup line outright. Run
  `check --write` with those skipped, and read the diff.
- **Whole domains do not apply.** Solid, Qwik and React Native rules fire on a React DOM app
  and cannot be satisfied, only suppressed; `noNodejsModules` and `noBunModules` fire on
  server code and on a suite that runs on Bun's own test runner. This is the price of
  `domains: all`, paid knowingly.
- **A rule can contradict another.** The ESLint config banned `Number.parseInt` and allowed
  the bare global `parseInt`. Biome's `useNumberNamespace` rewrites the bare global INTO
  `Number.parseInt`, so porting the ban verbatim banned both spellings of one function and
  flagged 14 correct call sites. The ban now covers `Number()` and `parseFloat` only.

## Rejected

- **Keeping ESLint alongside Biome.** Two linters means two definitions of green, which is
  the same objection CLAUDE.md makes to a second runtime. It also leaves the slowest tool in
  the gate.
- **Dropping Prettier entirely.** Biome 2.5 formats JS, TS, JSON, CSS, GraphQL and HTML, and
  neither Markdown nor YAML. Dropping it would silently stop format-checking 37 `.md` and 18
  `.yaml` files, including `docs/adr/` and the CI workflows. Prettier is confined to those
  two languages by `.prettierignore`, so no file has two formatters.
- **`preset: "recommended"` plus a curated list.** It is the comfortable answer and it makes
  the strictness a matter of taste that drifts at every review. Everything on, with each
  exception written at the place it applies, is auditable: `grep biome-ignore` lists the
  whole of it.
- **Moving the money bans to ast-grep**, which this repo already runs for the `layer-*` rules.
  Reasonable, and rejected only because the messages belong next to the linter a developer
  already sees in their editor. If GritQL plugins prove unstable, this is the fallback.

## Notes for the next upgrade

Two Biome 2.5.14 behaviours are worked around and should be re-tested:

- A regex **capture group** in a GritQL pattern is read as a variable binding and the plugin
  refuses to load — quietly. Use `(?:...)`.
- A plugin registered as `{ "path": ..., "includes": [...] }` deserialises without complaint
  and then never runs, on any file. `ui-server-import.grit` therefore scopes itself with
  `$filename` instead. If the object form works again, move the scope back to the config.

Both failures are invisible in a clean run, which is why `scripts/biomePlugins.test.ts` pins
each plugin from both sides — one fixture where it fires, one where it stays quiet.

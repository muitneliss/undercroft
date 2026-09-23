---
title: ADR 0017 Tests Are a Category in the Lint Config
type: source
date: 2026-09-21
tags: []
source: docs/adr/0017-tests-are-a-category-in-the-lint-config.md
source_path: docs/adr/0017-tests-are-a-category-in-the-lint-config.md
source_hash: a5ae9cee292402f77d9d164aac95d0f55366ba25ee68e9fd4ed7ccea34bb1998
ingested: 2026-09-21
---

# ADR 0017 Tests Are a Category in the Lint Config

`biome.jsonc` gains an `overrides` entry scoped to `**/*.test.ts(x)` that switches **ten** rules off, each with its reason written beside it in the config: `noBunModules`, `noNodejsModules`, `noMagicNumbers`, `noExcessiveLinesPerFunction`, `noExcessiveLinesPerFile`, `noMisplacedAssertion`, `noConditionalExpect`, `useExpect`, `useValidTestTitle` and `useQwikValidLexicalScope`. A rule belongs there only when its reason is "because it is a test" -- true of every test file identically, and of nothing else. Everything else stays suppressed at the file it applies to. This supersedes the "no rule is disabled in `biome.jsonc`" paragraph of [[ADR 0012 Biome Replaces ESLint and Prettier]], for test files only.

Why: ADR 0012 wanted every exception checkable at the file it applies to, and in suites that had stopped working. The ten rules accounted for **137 headers across 60 files** -- `noBunModules` in all 58 suites, `noMagicNumbers` in 35 -- and every one was the same sentence pasted again. A reason repeated 58 times is not read, it is scrolled past on the way to the imports; it cannot be revised without editing 58 files, and the copies had already drifted into three wordings. It also propagates, because a new suite starts by copying its neighbour's header block, so the suppression arrives before the code that would justify it.

Scope is the safeguard, because a too-wide `off` fails **silently** -- a glob that matched more than tests would leave the suite reporting nothing, which reads exactly like a clean run. `scripts/biomeTestOverride.test.ts` runs the real `biome.jsonc` over two fixtures holding identical code under two names and asserts three things: the rules fire in `probe.ts`, stay quiet in `probe.test.ts`, and a money violation in `probe.test.ts` is **still** reported. The last is what distinguishes an override from Biome skipping the suite.

Cost: two per-file reasons were folded into category ones and are no longer written down -- `gate.test.ts` explaining its loopback harness, `biomePlugins.test.ts` explaining its one magic number. That is the trade: 137 lines of repeated prose for two lines of specific prose.

Rejected: leaving it inline per ADR 0012 (the honest version is "accept that 137 suppressions are never read"); excluding test files from Biome entirely, which is one line and would take the `.biome/plugins` bans with it, `no-mocks.grit` included, whose whole subject is test files; moving all 32 rules the suites suppress into the override, which would put the repo-wide reasons in two places at once; and an ast-grep rule instead, which cannot switch a Biome rule off at all.

Extended from test files to every file by [[ADR 0018 A Lint Decision Lives in the Config]], and superseded in part by [[ADR 0022 A Test File Is Not an Exception]], which grew the override to twelve rules and closed the `biome-ignore-all` exemption for suites.

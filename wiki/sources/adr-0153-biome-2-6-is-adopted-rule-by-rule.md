---
title: ADR 0153 Biome 2.6 Is Adopted Rule by Rule
type: source
date: 2026-11-03
tags: []
source: docs/adr/0153-biome-2-6-is-adopted-rule-by-rule.md
source_path: docs/adr/0153-biome-2-6-is-adopted-rule-by-rule.md
source_hash: fd56374d2e7c4ca899315ce184540433be58856290fb0885f03be44d05030e2b
ingested: 2026-11-03
---

# ADR 0153 Biome 2.6 Is Adopted Rule by Rule

Accepted 2026-11-03. Extends [[ADR 0140 An Absent Framework's Rules Are Switched Off by Name]], whose measurement it repeats for a minor bump, and [[ADR 0018 A Lint Decision Lives in the Config]], whose rule -- every lint decision answered once in `biome.jsonc`, with its count -- is how each new rule was answered. Supersedes nothing. Touches [[ADR 0012 Biome Replaces ESLint and Prettier]]: Prettier keeps Markdown and YAML, for a new reason.

**Context.** Dependabot's #521 moves `@biomejs/biome` from 2.5.15 to 2.6.4; the owner chose to adopt 2.6 rather than pin it. Diffing the two configuration schemas: 2.6 promoted 59 rules out of nursery, added 114 and removed `useSortedClasses`. Five promoted rules named in `biome.jsonc` under their old group made the config fail to load -- `useBaseline` (now `suspicious`), `usePlaywrightValidDescribeCallback` (`correctness`), `noInlineStyles` (`style`), `noConditionalExpect` and `useExpect` (`suspicious`) -- and `useVarsOnTop` (`style`) was named in a suppression comment. With the config loading, `biome lint` went from 0 findings to 3,883 from 21 rules, and `biome format` reported 231 Markdown files: 2.6 formats and lints Markdown by default.

**Decision.** (1) Biome does not read Markdown: `files.includes` excludes `**/*.md`, because Prettier and the Ymir CLI already format it and `useFencedCodeLanguage` (24) fired in wiki pages and accepted ADRs. `markdown.linter.enabled: false` was measured not to hold. YAML needs nothing; its Biome formatter is off by default. (2) Every other rule answered on its own terms. Off repo-wide: `noNull` (2,994; `null` is rule 2's visible "missing", and `JSON.stringify` drops `undefined`), `noExcessiveStatementsPerFunction` (581; every source finding already passes `noExcessiveLinesPerFunction`), `noUnreadableForOfExpression` (59), `useLowercaseTestTitle` (53; titles begin with proper nouns), `useIteratorZip` (2; the ES2023 lib lacks `Iterator.zip`). Off at named files: `noProcessExit` (24, entry points), `noDanglingUnderscore` (17; tRPC `_def`, MCP `_meta`, Zod `_zod`, the Vite define), `useTailwindStaticClassStrings` (5; BEM modifiers, not utilities). Fixed: `useArraySortCompare` (41, with `byCodeUnit`, or the same comparison spelled in place in import-free `rowRules.ts` and `scripts/`), `useCapitalizedConstructors` (21), `noReturnArrayPush` (17, including renaming `RecordSplitter#push` to `take`), `noNestedTemplateLiterals` (16), `noUnsafeReturn` (7), `noPromiseExecutorReturn` (7), `noEagerArrayMethodsInLoops` (5), `useMathTrunc` (2; `(rk | 0) >> 2` is `rk >> 2`), `noZeroLengthUnit` (one fixed, one line-level suppression where `--head-col: 0rem` reaches a `calc()` sum), `noUselessSplice` (1), `noUselessAssignment` (1). (3) The two big repo-wide entries are reasons, not volume. (4) A suppression range is not an expiring suppression: measured on 2.6.4, Biome reports an unused line-level `// biome-ignore` but never an unused `biome-ignore-start`/`-end` range, so `drivePicker.ts`'s range became two line-level suppressions.

**Rejected.** Pinning Biome at 2.5.15; satisfying `noNull` or `noExcessiveStatementsPerFunction`; `allowedPrefixes` for `useLowercaseTestTitle`; making `@undercroft/contracts` depend on `@undercroft/core` for one comparator (`rowRules.ts` and `access.ts` document that they import nothing); leaving Markdown to two formatters.

**Consequences.** `biome lint` reports nothing. Line-level suppressions are nineteen across seventeen files, listed in `.claude/rules/suppressions.md`. The next minor bump repeats the measurement: config first, then the schema diff, then each new rule with its count.

---
title: ADR 0018 A Lint Decision Lives in the Config
type: source
date: 2026-09-21
tags: []
source: docs/adr/0018-lint-decisions-live-in-the-config.md
source_path: docs/adr/0018-lint-decisions-live-in-the-config.md
source_hash: 0c9382f6554aba25f593e5ac2d0cfe493f9be3139772f1088b0c03fc55c4c95c
ingested: 2026-09-21
---

# ADR 0018 A Lint Decision Lives in the Config

`preset: "all"` stays; what changes is **where** a rule that cannot hold is answered. Six parts: `domains` names the four frameworks this repo actually used at the time (`project`, `react`, `test`, `types`) and the other eleven are `none`; a rule that cannot hold anywhere is switched off in `biome.jsonc` once, with its reason beside it; a rule that cannot hold at a handful of named places becomes a path entry in `overrides`, so it stays on everywhere else; `biome-ignore-all` is banned outside test files by `.ast-grep/rules/no-biome-ignore-all.yml`; the `lint:` and `lint/plugin:` spellings are banned **everywhere**, test files included, because both silence the money and no-mock plugins; and `bun run lint` gains `--error-on-warnings`, so the one remaining form -- the line-level `// biome-ignore` -- fails the gate once Biome reports it unused. Supersedes the "no rule is disabled in `biome.jsonc`" paragraph of [[ADR 0012 Biome Replaces ESLint and Prettier]] and extends [[ADR 0017 Tests Are a Category in the Lint Config]] from test files to every file.

Why, measured against Biome 2.5.14 over **679 headers**. A header is a permit for the whole file, not for the line that needed one: the one in `fetcher.ts` explains `noMagicNumbers` for slice offsets, and appending an unrelated `86_400 * 37` to that file left the gate green. Biome never reports a `biome-ignore-all` that has stopped being needed, though it does report an unused line-level one -- so ADR 0012's promise that a reviewer could delete each exception when it stopped being true had no machine behind it, and **17 of the 679 were already dead**, all seven `useQwikValidLexicalScope` headers among them. Most headers were not decisions about the code at all but the cost of `domains: all`: of 1,377 findings hidden in non-test files, **255 came from frameworks this repo does not use**, 196 of them the single Solid rule `noReactSpecificProps`, whose autofix rewrites `className` to `class` and breaks `tsc`.

Cost: 524 headers deleted plus 8 rewritten as CSS/SVG block comments; roughly 190 findings fixed as code, \~700 answered repo-wide, \~90 path-scoped, 255 removed by switching eleven domains off. The code fixes are what the exercise was for -- every regex literal hoisted to module scope and named, return types on 23 functions, `useId()` replacing seven hardcoded element ids, `isRecord` guards replacing four unsafe assertions, `instanceof Error` replacing `(error as Error)`, causes threaded through `ObjectNotFound` and `SpecError`. One rule is off because it is **wrong** rather than opinionated: `noUnnecessaryConditions` calls the null guard after `DECIMAL.exec(amount)` always-falsy, and deleting that guard makes `tsc` answer `TS18047`; `tsc` is the check that binds.

Two things are left undone and recorded rather than hidden: `packages/crypto/src/seal.ts` defaults its `env` parameter to `process.env`, whose fix is a cross-package API change rather than a lint edit; and twelve files assert a shape onto `JSON.parse` / `response.json()` where the better answer is a Zod schema at each boundary, which changes what the code **checks**.

Rejected: converting all 679 to line-level suppressions, which Biome can even write, producing \~1,616 inline comments across 165 files with one sentence repeated -- precisely the disease ADR 0017 cured -- and two findings that cannot be converted at all, since `useFilenamingConvention` is anchored at line 0 where no comment can precede it; keeping the headers plus an inventory file, which works but keeps a second copy of a list `biome.jsonc` can hold directly; and leaving `domains: all` and suppressing, the status quo that taught readers to skip suppression headers in the first place.

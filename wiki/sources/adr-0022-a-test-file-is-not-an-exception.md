---
title: ADR 0022 A Test File Is Not an Exception
type: source
date: 2026-09-21
tags: []
source: docs/adr/0022-a-test-file-is-not-an-exception.md
source_path: docs/adr/0022-a-test-file-is-not-an-exception.md
source_hash: 179eaef2e5b93c094ac5650f69cab2c637fbce65063b72f662cc5958228031da
ingested: 2026-09-21
---

# ADR 0022 A Test File Is Not an Exception

No file in this repository may carry a `// biome-ignore-all` header -- not a source file, and **not a test file**. Two things make that possible rather than merely strict. The `**/*.test.ts(x)` override in `biome.jsonc` grows from ten rules to **twelve**: `noUnsafeTypeAssertion`, `useExplicitReturnType`, `useTopLevelRegex`, `noSecrets` and `useAwait` join it, while `noMagicNumbers`, `useValidTestTitle` and `useQwikValidLexicalScope` had already left for the repo-wide block or with the Qwik domain. And the line-level `// biome-ignore` stays available, which is the better tool anyway -- Biome reports one that has stopped being needed and `--error-on-warnings` turns that report into a failure, whereas a file-wide header cannot expire. `.ast-grep/rules/no-biome-ignore-all.yml` drops its `ignores` for suites, so the ban is total and mechanical. Supersedes the "in a test exactly as in a source file" paragraph of [[ADR 0017 Tests Are a Category in the Lint Config]] and extends [[ADR 0018 A Lint Decision Lives in the Config]], which had left test files alone.

Why: ADR 0017 assumed the inline suppressions in suites were about one suite each. Measured, they were not. After ADR 0018, **241 headers** remained across 84 suites; stripping every one and re-running Biome produced **148 findings**, so 93 headers were answering rules that no longer fired at all -- dead for the same mechanical reason ADR 0018 named, that Biome never reports a stale `biome-ignore-all`. The 148 real findings split sharply: **134** were the same sentence in every suite (`noUnsafeTypeAssertion` 39, `useTopLevelRegex` 35, `useExplicitReturnType` 32, `noSecrets` 23, `useAwait` 5) and only **14** were genuinely about one file, of which nine were fixed as code and five kept a line-level suppression.

Each of the 134 is the shape ADR 0017 sent to the config, arriving a second time. `noUnsafeTypeAssertion` is `(await res.json()) as { code: string }` thirty-nine times -- a response body **is** `unknown` until something names it, and in a test the name is the assertion. `useTopLevelRegex` guards a literal recompiled on a hot path, and a test runs its assertion once. `noSecrets` fires on a 25-digit money fixture and an invented `ya29.` token, and `.claude/rules/pii.md` **requires** fixtures to be invented rather than anonymised, so a suite is exactly where high-entropy non-secrets belong. ADR 0017's objection -- that moving these would put one reason in two places -- was sound when written and is spent, because ADR 0018 moved the source-side reasons into the config too. So the exemption had nothing left in it; a carve-out protecting zero cases is just the hole the next pasted header comes through.

Cost: five rules that were on for test files are now off for them. A new suite gets `noUnsafeTypeAssertion` for free where a source file still argues for it, though the narrower bans that matter -- `as unknown as`, casting builders, mocks -- are untouched, since `no-mocks.grit` and `.claude/rules/tests.md` are not Biome core rules. `noSecrets` being off for suites means a real credential pasted into a fixture would not be caught by that rule; it never was, and CI's `secrets` job scanning the diff is where true positives are found. The fixture in `scripts/biomeTestOverride.test.ts` grew to trip eight of the twelve rules rather than three; the suites themselves pin the remaining four. The whole tree's stock of line-level suppressions is now **seven, across five files**.

Rejected: leaving the exemption open in case; moving the 14 one-offs into the config as well, which would put "this `^` flips a tag bit" a file away from the byte it describes and remove the one suppression form that expires by itself; turning the five rules off repo-wide instead of for tests, since `useTopLevelRegex` and `noSecrets` do real work in source; and excluding `*.test.ts` from `lint:rules`, which would take `no-usestate`, the `layer-*` rules and `no-mocks` reachability with it, for a rule about comments.

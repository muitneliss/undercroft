---
title: ADR 0140 An Absent Framework's Rules Are Switched Off by Name
type: source
date: 2026-10-16
tags: []
source: docs/adr/0140-an-absent-frameworks-rules-are-switched-off-by-name.md
source_path: docs/adr/0140-an-absent-frameworks-rules-are-switched-off-by-name.md
source_hash: c2bc5e50caf9ce49637ff0f03f596a861663b69a185ade255f4f5f51e49f54f6
ingested: 2026-10-16
---

# ADR 0140 An Absent Framework's Rules Are Switched Off by Name

# ADR 0140 An Absent Framework's Rules Are Switched Off by Name

Accepted 2026-10-16. Supersedes, from [[ADR 0018 A Lint Decision Lives in the Config]], decision 1's mechanism: that setting a Biome domain to `none` is what keeps an absent framework's rules off. Keeps everything else there: `preset: "all"`, every group escalated to `error`, the `domains` map naming the frameworks the repo has, and every rule that cannot hold answered once in `biome.jsonc` with its reason.

**Context.** Dependabot's #477 moved Biome from 2.5.14 to 2.5.15 during the Actions outage, so no gate ran on it. On the same tree and config, `biome lint` went from 0 findings to 2,539; 2,011 were rules of frameworks the repo does not have: `noReactSpecificProps` (Solid, Qwik; 1,729 in 131 `.tsx` files), `useSolidForComponent` (134), `noSolidDestructuredProps` (118) and `useQwikValidLexicalScope` (30). The cause is biomejs/biome#11919: a rule enabled explicitly in the configuration now outranks a domain set to `none` (`LintVisitor::finish` removes `as_explicitly_enabled_rules()` from the disabled set), and a group written as a bare severity such as `"suspicious": "error"` counts as enabling every rule in it. The same PR fixed #11899, so `useExhaustiveDependencies`, previously off for every React file because `next` was `none`, came back with four real findings. Deleting the group severities was measured to take 2.5.15 to 13 findings. The blog's `react: none` override also stopped reaching `noUnknownAttribute` (17 findings on `class` and `datetime` in `.astro` templates).

**Decision.** An absent framework's rule that fires is switched off by name, with its count, in one repo-wide `overrides` entry; today the four above. A rule that finds nothing stays as it is: 82 rules belong only to `none` domains here and 77 report nothing. The `domains` map stays as the statement of which frameworks the repo has. The blog's override names `noUnknownAttribute` (17) and `useUniqueElementIds` (2).

**Rejected.** Dropping the group severities (they are what makes an `info` rule fail the gate); switching off all 82 (77 entries with nothing to count); pinning Biome at 2.5.14 (the owner asked for every bump kept, and a pin leaves `useExhaustiveDependencies` off); waiting for upstream (#11919 is deliberate, with a changeset and snapshot tests).

**Consequences.** The other 2.5.15 findings were answered on their own terms: `useLogicalProperties` (474) and `useStrictBooleanExpressions` (22, 14 of them inference errors) off repo-wide with measurements; `useArraySortCompare` (7) fixed with `byCodeUnit`, now in `@undercroft/core`; `useExhaustiveDependencies` (4), `noReactObjectTypeAsDefaultProp` (1) and `useNullishCoalescing` (1) fixed in code; `useAwaitThenable` (1, a false positive on `Extracted | Promise<Extracted>`) and `noAstroSetHtmlDirective` (1, the blog's JSON-LD, now escaped) carry a line-level `// biome-ignore`. See also [[ADR 0012 Biome Replaces ESLint and Prettier]].

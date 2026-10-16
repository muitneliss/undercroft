# 140. An absent framework's rules are switched off by name

- Status: Accepted
- Date: 2026-10-16
- Supersedes: from [ADR 0018](0018-lint-decisions-live-in-the-config.md), decision 1's mechanism
  -- that setting a domain to `none` is what keeps an absent framework's rules off
- Keeps: everything else in ADR 0018 -- `preset: "all"`, every group escalated to `error`, the
  `domains` map naming the frameworks this repo has, and every rule that cannot hold answered
  once in `biome.jsonc` with its reason

## Context

Dependabot's #477 moved Biome from 2.5.14 to 2.5.15 during the Actions outage (ADR 0136), so
no gate ran on it. On the same tree, with the same `biome.jsonc`, `biome lint` went from **0**
findings under 2.5.14 to **2,539** under 2.5.15. 2,011 of them were rules of frameworks this
repo does not have:

| Rule                       | Domain      | Findings | Where                  |
| -------------------------- | ----------- | -------- | ---------------------- |
| `noReactSpecificProps`     | solid, qwik | 1,729    | 131 `.tsx` files       |
| `useSolidForComponent`     | solid       | 134      | 130 `.tsx`, 4 `.astro` |
| `noSolidDestructuredProps` | solid       | 118      | 10 `.tsx` files        |
| `useQwikValidLexicalScope` | qwik        | 30       | 19 `.ts` files         |

The cause is [biomejs/biome#11919](https://github.com/biomejs/biome/pull/11919), shipped in
2.5.15 as the fix for #11899. It changed two things. A rule in two domains now stays on when
either enables it -- with `"next": "none"`, `useExhaustiveDependencies` had been off for every
React file here, and four real findings surfaced in `RunEvents.tsx` and `SqlEditor.tsx`. And
"rules enabled explicitly in the configuration also stay enabled when one of their domains is
set to `none`": `LintVisitor::finish` removes every rule in `as_explicitly_enabled_rules()` from
the disabled set, and that function collects each group's `get_enabled_rules()`. For a group
written as a bare severity -- `"suspicious": "error"`, which is how this config escalates every
group -- that is every rule in it, so every rule in the preset counts as "explicit" and `none`
now outranks almost nothing.

Measured, not inferred: deleting the eight group severities and keeping `preset: "all"` takes
2.5.15 from 2,539 findings to 13, and the Solid and Qwik rules to none. The same switch
explains the blog: its `"react": "none"` override stopped reaching `noUnknownAttribute`, and 17
`class` and `datetime` attributes in `.astro` templates came back as "not valid React props".

## Decision

1. **An absent framework's rule that fires is switched off by name**, in one repo-wide
   `overrides` entry with the count beside each, in `biome.jsonc`. Today that is the four above.
2. **A rule that finds nothing stays as it is.** 82 rules belong only to domains set to `none`
   here; 77 report nothing in this tree, and switching them off would be a decision about code
   nobody has written. When a bump brings one to life on code that is not its framework's, it
   joins the entry with its count -- the same measurement this ADR records.
3. **The `domains` map stays**, as the statement of which frameworks this repo has. It still
   decides the globals a domain adds, and a later Biome that restores `none` makes it work
   again; the comment above it says plainly that, until then, it switches off almost nothing.
4. **The blog's override names what it needs**: `noUnknownAttribute` (17) and
   `useUniqueElementIds` (2), the latter because an override that carries any `rules` lets the
   group severities beat its `react: none` for that rule as well.

## Rejected

**Drop the group severities.** It is the change that restores `none`, and it was measured: 13
findings. But the severities are what escalate an `info` or `warn` rule to a failing one (ADR
0018, and the reason `preset: "all"` was paired with them). Without them every `info` rule in
the preset stops failing the gate, which trades 2,011 wrong findings for an unknown number of
right ones that no longer count.

**Switch off all 82.** It restores ADR 0018's intent exactly, but 77 of the entries would carry
no count, because there is nothing to count. A list nobody can check against the tree is the
thing `suppressions.md` exists to stop, and it would still miss whatever rule the next Biome
adds to those domains.

**Pin Biome at 2.5.14.** The person who owns the repo asked for every bump in #477 to be kept and
its failures fixed; a pin also leaves `useExhaustiveDependencies` off for every React file,
which #11919 was right to end.

**Wait for upstream.** #11919 is a deliberate behaviour, with a changeset and snapshot tests
(`explicitly_enabled_rule_is_not_disabled_by_domain`), not an accident a patch release will
revert. If it is reverted, decision 3 is what makes the entries in decision 1 removable at once.

## Consequences

The other 2.5.15 findings were answered on their own terms in the same change, each in
`biome.jsonc` or at the line: `useLogicalProperties` (474) and `useStrictBooleanExpressions`
(22, 14 of them its inference being wrong) are off repo-wide with their measurements;
`useArraySortCompare` (7) is fixed with `byCodeUnit`, now in `@undercroft/core`;
`useExhaustiveDependencies` (4), `noReactObjectTypeAsDefaultProp` (1) and `useNullishCoalescing`
(1, whose suggested `??=` would have re-inflated an unreadable archive member) are fixed in the
code; `useAwaitThenable` (1, a false positive on `Extracted | Promise<Extracted>`) and
`noAstroSetHtmlDirective` (1, the blog's JSON-LD, now escaped) carry a line-level
`// biome-ignore`, which Biome reports the day it is no longer needed.

# 153. Biome 2.6 is adopted rule by rule

- Status: Accepted
- Date: 2026-11-03
- Extends: [ADR 0140](0140-an-absent-frameworks-rules-are-switched-off-by-name.md), whose
  measurement this repeats for a minor bump, and
  [ADR 0018](0018-lint-decisions-live-in-the-config.md), whose rule -- every lint decision is
  answered once in `biome.jsonc`, with its count -- is how each new rule below was answered.
  Nothing in either is superseded.
- Touches: [ADR 0012](0012-biome-replaces-eslint-and-prettier.md), whose split of the formatters
  (Prettier for Markdown and YAML) stays, for a new reason recorded in decision 1.

## Context

Dependabot's #521 moves `@biomejs/biome` from 2.5.15 to 2.6.4, beside six development bumps that
changed nothing. The person who owns the repo chose to adopt 2.6 in that PR rather than pin it
back, as for 2.5.15 in ADR 0140.

The config did not load under 2.6.4. Comparing the two releases' configuration schemas: 2.6
**promoted 59 rules out of nursery** into the stable groups, **added 114**, and removed one
(`useSortedClasses`). Five of the promoted rules are named in `biome.jsonc`, where a rule under
its old group is a configuration error, and a sixth in a suppression comment, where it is a
"failed to parse category" diagnostic:

| Rule                                 | Now in        | Where it is named                                          |
| ------------------------------------ | ------------- | ---------------------------------------------------------- |
| `useBaseline`                        | `suspicious`  | `blog.css`, `index.css` + `**/*.svg`, `landing-cover.css`  |
| `usePlaywrightValidDescribeCallback` | `correctness` | the Drive API helper and the connector runtime's reader    |
| `noInlineStyles`                     | `style`       | the seven components whose styles are computed per element |
| `noConditionalExpect`, `useExpect`   | `suspicious`  | the `**/*.test.ts(x)` override                             |
| `useVarsOnTop`                       | `style`       | a `biome-ignore-start`/`-end` range in `drivePicker.ts`    |

With the config loading, the same tree went from **0 findings to 3,883** under `preset: "all"`
and the eight group severities, from 21 rules, all of them new except `useArraySortCompare` and
the moved `useVarsOnTop` (`biome lint --error-on-warnings --reporter=github .`). And `biome
format .` reported **231 Markdown files**: 2.6 formats and lints Markdown by default.

## Decision

1. **Biome does not read Markdown.** `files.includes` excludes `**/*.md`. Prettier formats the
   repo's Markdown and the Ymir CLI formats the wiki's (`.prettierignore` already says both), so
   Biome's formatter was a second formatter on 231 files, and its one Markdown rule that fired,
   `useFencedCodeLanguage` (24), fired in three wiki pages no hand may edit and in seven
   accepted ADRs. `markdown.linter.enabled: false` was tried first and measured not to hold: it
   stops the formatter, and `useFencedCodeLanguage` still fired on `README.md`. YAML needs
   nothing: 2.6.4 can format it, but its YAML formatter is off by default and nothing switched it
   on. Moving the docs to Biome is a decision about their formatter, with the wiki's tool and the
   ADRs' immutability to weigh, and it is not made inside a dependency bump.

2. **Every other new finding is answered on its own terms**, the way ADR 0140 answered 2.5.15's:
   fixed where the rule is right, off at named files where it misreads them, and off repo-wide
   only where it cannot hold anywhere -- each with its count in `biome.jsonc`.

   | Rule                               | Findings | Disposition                                                                                                                                                                                         |
   | ---------------------------------- | -------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `noNull`                           |    2,994 | Off repo-wide. `null` is rule 2's "missing, visibly": `parseAmount` returns it, and `JSON.stringify` drops an `undefined` field, so the rewrite would make a missing amount vanish from the wire.   |
   | `noExcessiveStatementsPerFunction` |      581 | Off repo-wide. All 438 outside a suite are in functions `noExcessiveLinesPerFunction` (on, 50 lines) already passes; meeting 10 statements means conjoined fragments.                               |
   | `noUnreadableForOfExpression`      |       59 | Off repo-wide. The repo's loop idioms -- `of await claim()` (11), `of x ?? []` (17), `Object.entries` -- with a temporary would name each collection twice.                                         |
   | `useLowercaseTestTitle`            |       53 | Off repo-wide. Every one begins with a proper noun or a component's name.                                                                                                                           |
   | `useArraySortCompare`              |       41 | Fixed. Every one sorts strings; `byCodeUnit` (ADR 0140) where the package reaches `@undercroft/core`, the same comparison spelled in place in `rowRules.ts` (which imports nothing) and `scripts/`. |
   | `useFencedCodeLanguage`            |       24 | Gone with decision 1.                                                                                                                                                                               |
   | `noProcessExit`                    |       24 | Off at the entry points: servers, CLIs, `scripts/**`, the spec validator, the wiki hook. On below them.                                                                                             |
   | `useCapitalizedConstructors`       |       21 | Fixed: `CARD` in `syncCards.ts` is `t`, as `messages()` is named everywhere else; a suite's `SKILL()` helper is `skillMarkdown()`.                                                                  |
   | `noReturnArrayPush`                |       17 | Fixed: 16 arrow bodies take braces. The 17th was `RecordSplitter#push`, not an array's; it is `take` now, since a `push` that returns records reads as `Array#push`.                                |
   | `noDanglingUnderscore`             |       17 | Off at nine files. Every name is someone else's: tRPC's `_def`, MCP's `_meta`, Zod's `_zod`, the Vite define `__UNDERCROFT_RELEASE__`. The rule has no allow-list.                                  |
   | `noNestedTemplateLiterals`         |       16 | Fixed, each inner template named as a `const`.                                                                                                                                                      |
   | `noUnsafeReturn`                   |        7 | Fixed. Four stop an `any` at its source with `: unknown`; a suite's `findByRole<HTMLButtonElement>`, an unchecked assertion, is an `instanceof` check; a YAML parse is checked to be a mapping.     |
   | `noPromiseExecutorReturn`          |        7 | Fixed: the executors take block bodies.                                                                                                                                                             |
   | `useTailwindStaticClassStrings`    |        5 | Off at the five components. Each is a BEM modifier of the sheet's own block, which no Tailwind scanner is asked to find.                                                                            |
   | `noEagerArrayMethodsInLoops`       |        5 | Fixed: the filter is a guard in the loop.                                                                                                                                                           |
   | `useVarsOnTop`                     |        2 | `drivePicker.ts`'s range suppression, now two line-level ones: an unused range is never reported (decision 4).                                                                                      |
   | `useMathTrunc`                     |        2 | Fixed. `(rk \| 0) >> 2` is `rk >> 2`, since `>>` already reads its operand as a signed 32-bit integer; the day-count parse reads the field's text without `String()`.                               |
   | `useIteratorZip`                   |        2 | Off repo-wide: every tsconfig compiles against the ES2023 lib, which does not declare `Iterator.zip`.                                                                                               |
   | `noZeroLengthUnit`                 |        2 | One fixed (`@property`'s `initial-value`). One line-level `biome-ignore`: `--head-col: 0rem` reaches a `calc()` sum, where a unitless `0` is invalid.                                               |
   | `noUselessSplice`                  |        1 | Fixed: `buffer.length = 0`.                                                                                                                                                                         |
   | `noUselessAssignment`              |        1 | Fixed: the flag is declared unassigned, since both branches set it.                                                                                                                                 |

3. **The repo-wide entries are reasons, not volume.** `noNull` and
   `noExcessiveStatementsPerFunction` are 3,575 of the 3,883 findings, and both are off because
   the code is right and the rule is asking for something this repo has decided against -- rule 2,
   and functions deep rather than cut to a count -- not because they were many.

4. **A suppression range is not an expiring suppression.** Measured on 2.6.4: Biome reports an
   unused line-level `// biome-ignore` under `--error-on-warnings`, and does not report an unused
   `biome-ignore-start`/`-end` range. The range outlives its reason exactly as a
   `biome-ignore-all` header did (ADR 0018), so the one range in the tree, around
   `drivePicker.ts`'s two ambient `var`s, is two line-level suppressions now, and
   `.claude/rules/suppressions.md` says a range is not the form.

## Rejected

**Pin Biome at 2.5.15.** The owner chose to adopt 2.6 in this PR. A pin also forgoes the rules
that found real defects: an unchecked type argument in a suite, the `any` from a YAML parse
returned as a record, a misleading `push`.

**Satisfy `noNull` and `noExcessiveStatementsPerFunction`.** The first trades a visible "missing"
for a field that disappears in JSON; the second cuts 438 functions that already meet the length
bound into pieces that have to be read in order.

**`allowedPrefixes` for `useLowercaseTestTitle`.** It would list every product, language and
component a title can begin with, and grow with each.

**Make `@undercroft/contracts` depend on `@undercroft/core` for `byCodeUnit`.** `rowRules.ts`
and `access.ts` both document that they import nothing, which is what keeps the access grammar
readable from any bundle; a package dependency, a project reference and a lockfile change for
one comparison is the wrong price. Its seven sorts were all `[...new Set(x)].sort()`, now one
module-private `distinctSorted`.

**Leave Markdown to both formatters.** That is the drift `.prettierignore` was written to stop,
and on 231 files at once.

## Consequences

`biome lint` reports nothing on the tree. The line-level suppressions are nineteen across seventeen
files -- the CSS zero and `drivePicker.ts`'s two are new to the count, and the `pg` import's,
made dead by pg 8.23 in the same week, is gone -- and
`.claude/rules/suppressions.md` lists them. The next minor bump repeats this measurement: config
first, then the schema diff, then each new rule answered with its count.

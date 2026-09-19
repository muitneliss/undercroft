# 22. A test file is not an exception

- Status: Accepted
- Date: 2026-09-19
- Supersedes: the "everything else is suppressed at the file it applies to … in a test exactly
  as in a source file" paragraph of
  [ADR 0017](0017-tests-are-a-category-in-the-lint-config.md), and its rejected option
  "moving every rule the suites suppress into the override"
- Extends: [ADR 0018](0018-lint-decisions-live-in-the-config.md), which left test files alone

## Decision

No file in this repository may carry a `// biome-ignore-all` header. Not a source file, and
**not a test file**.

Two things make that possible rather than merely strict:

1. The `**/*.test.ts(x)` override in `biome.jsonc` grew from ten rules to **twelve**.
   `noUnsafeTypeAssertion`, `useExplicitReturnType`, `useTopLevelRegex`, `noSecrets` and
   `useAwait` joined it; `noMagicNumbers`, `useValidTestTitle` and `useQwikValidLexicalScope`
   had already left for the repo-wide block or with the Qwik domain.
2. The line-level `// biome-ignore` stays available, and it is the better tool anyway: Biome
   reports one that has stopped being needed, and `bun run lint --error-on-warnings` turns
   that report into a failure. A file-wide header cannot expire; a line-level one does it by
   itself.

`.ast-grep/rules/no-biome-ignore-all.yml` drops its `ignores` for `**/*.test.ts(x)`, so the
ban is now total and mechanical. `scripts/suppressions.test.ts` pins it from both sides in a
suite as well as in source.

## Why

ADR 0017 drew the line in the right place for what it could see. Ten rules whose answer was
"because it is a test" went into the config; everything else stayed inline "in a test exactly
as in a source file", because a rule with a reason about _one suite_ belongs beside that
suite.

That sentence assumed the inline suppressions were about one suite. Measured, they were not.
After ADR 0018, **241 headers** remained across 84 suites. Stripping every one of them and
re-running Biome produced **148 findings** — so 93 headers were answering rules that no longer
fired at all, dead exactly as ADR 0018 predicted and for the same mechanical reason: Biome
never reports a stale `biome-ignore-all`.

The 148 that were real fell into two groups, and the split was not close:

|                                  | findings | shape                                                                                                       |
| -------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| the same sentence in every suite | **134**  | `noUnsafeTypeAssertion` 39, `useTopLevelRegex` 35, `useExplicitReturnType` 32, `noSecrets` 23, `useAwait` 5 |
| genuinely about one file         | **14**   | nine fixed as code, five kept a line-level `// biome-ignore`                                                |

Every one of the 134 is the shape ADR 0017 sent to the config, arriving a second time:

- `noUnsafeTypeAssertion` is `(await res.json()) as { code: string }`, 39 times. A response
  body **is** `unknown` until something names it, and in a test the name is the assertion.
- `useTopLevelRegex` is a pattern written inside the assertion it describes. The rule guards a
  literal recompiled on a hot path; a test runs its assertion once.
- `noSecrets` is a 25-digit money fixture and an invented `ya29.` token. `pii.md` **requires**
  fixtures to be invented rather than anonymised, so a suite is precisely where high-entropy
  strings that are not secrets belong.
- `useAwait` is a seam whose _type_ is async — a `typeof fetch` recorder, a
  `run: () => Promise<string>` counter. Dropping `async` would stop it matching.

ADR 0017 rejected moving these on the grounds that it "would put the repo-wide reasons in two
places at once: the config for tests, the file for source." That objection was sound when it
was written and is now spent: ADR 0018 moved the source-side reasons into the config too, so
there is one owner again, not two.

The remaining 14 are the ones ADR 0017 was actually describing, and they are what the inline
form is for — a `^ 0x01` that flips a GCM tag bit because flipping one bit **is** the test, a
compose file's `${IMAGE_TAG:-latest}` quoted as fixture bytes, an integration suite reading
the env var that turns it on. Five lines, five reasons, each of which Biome will tell us about
when it stops being true — and they bring the tree's whole stock of line-level suppressions to
seven, across five files.

**So the exemption had nothing left in it.** That is the whole argument for closing it. A
carve-out that protects zero cases is not a concession to a real need; it is the hole the next
pasted header comes through — and "copy the header block from the neighbouring suite" is the
exact mechanism ADR 0017 named for how the repo reached 137 copies of one sentence.

## What it cost

Five rules that were on for test files are now off for them, and each buys something back
that the 241 headers were hiding:

- A new suite gets `noUnsafeTypeAssertion` for free where a source file still argues for it.
  The narrower bans that matter — `as unknown as`, casting builders, mocks — are unaffected:
  `.claude/rules/tests.md` and `no-mocks.grit` still hold, and neither is a Biome core rule.
- `noSecrets` is off for suites, so a real credential pasted into a fixture would not be
  caught by _this_ rule. It never was: the `secrets` job in CI scans the diff, and `pii.md` is
  the rule that governs it. A suite is where the false positives live and the scanner is where
  the true ones are found.

The fixture in `scripts/biomeTestOverride.test.ts` grew to trip eight of the twelve rules
rather than three, so each override entry is now pinned by a file that would fire without it.
The remaining four need a file long or convoluted enough to trip them, which a fixture cannot
be without becoming the thing it measures; the suites themselves pin those.

## Rejected

- **Leaving the exemption in place.** The honest version is "leave a door nobody is using
  open, in case". Its only remaining effect is that a header pasted into a new suite passes
  the gate — which is how this started.
- **Moving the 14 one-offs into the config too, and banning line-level suppressions as well.**
  That would put "this `^` flips a tag bit" in `biome.jsonc`, a file away from the byte it
  describes, and it would remove the one suppression form that expires by itself. The
  line-level `// biome-ignore` is not the problem; the file-wide one is.
- **Turning the five rules off repo-wide instead of for tests.** `useTopLevelRegex` and
  `noSecrets` do real work in source — `noSecrets` is scoped to four named files there, on
  everywhere else. Scoping to tests is the narrower change and the measurement supports
  exactly it.
- **Excluding `*.test.ts` from `lint:rules`.** It would take `no-usestate`, the `layer-*`
  rules and `no-mocks` reachability with it, for a rule about comments.

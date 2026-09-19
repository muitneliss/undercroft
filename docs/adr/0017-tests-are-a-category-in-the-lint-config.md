# 17. Tests are a category in the lint config, not sixty copies of one reason

- Status: Accepted
- Date: 2026-09-19
- Supersedes: the "no rule is disabled in `biome.jsonc`" paragraph of
  [ADR 0012](0012-biome-replaces-eslint-and-prettier.md), for test files only

## Decision

`biome.jsonc` carries an `overrides` entry scoped to `**/*.test.ts` and `**/*.test.tsx` that
switches **ten** rules off, each with its reason written beside it in the config:

| rule                                     | why, once                                                     |
| ---------------------------------------- | ------------------------------------------------------------- |
| `nursery/noBunModules`                   | Bun is the test runner; `bun:test` is the toolchain           |
| `correctness/noNodejsModules`            | a suite reads fixtures and temp dirs; `node:` is its platform |
| `style/noMagicNumbers`                   | in a test the number **is** the assertion                     |
| `complexity/noExcessiveLinesPerFunction` | a `describe` block's length is how many behaviours it pins    |
| `style/noExcessiveLinesPerFile`          | likewise, for a harness too delicate to keep two copies of    |
| `suspicious/noMisplacedAssertion`        | an assertion inside a helper several tests call               |
| `nursery/noConditionalExpect`            | asserting inside a callback the code under test invokes       |
| `nursery/useExpect`                      | bodies whose assertion is that the call did not throw         |
| `nursery/useValidTestTitle`              | titles are full sentences naming the promise                  |
| `correctness/useQwikValidLexicalScope`   | there is no Qwik in this repo                                 |

A rule belongs here only when its reason is **"because it is a test"** — true of every test
file, identically, and of nothing else. Everything else is suppressed at the file it applies
to with a reason about that file, in a test exactly as in a source file: `useExplicitType`,
`noUnsafeTypeAssertion`, `useTopLevelRegex`, `useNamingConvention`, `noTernary`, `noSecrets`
and `noNonNullAssertion` all stay inline. ADR 0012 continues to govern them.

## Why

ADR 0012's rule — suppress at the file, never in the config — was chosen so that a reviewer
can check each exception and delete it when it stops being true. In source files it does
that. In test files it had stopped: the ten rules above accounted for **137 headers across
60 files**, `noBunModules` appearing in all 58 suites and `noMagicNumbers` in 35, and every
one of them was the same sentence pasted again.

That inverts what ADR 0012 wanted. A reason repeated 58 times is not read; it is scrolled
past on the way to the imports. It cannot be revised, because revising it means editing 58
files and the copies have already drifted into three wordings. And it propagates: a new test
file starts by copying the header block from its neighbour, so the suppression arrives before
the code that would justify it, and outlives whatever did.

The reasons did not disappear — they moved to the one place the decision now lives, which is
also the only place it can be edited once. Writing them there is what `.jsonc` is for, and
this repo already uses it for exactly that.

**Scope is the safeguard.** A wide `off` and a narrow one fail differently, and the wide
failure is silent: a glob that matched more than tests, or an `off` that reset its group
under `preset: "all"`, would leave the suite reporting nothing, which reads exactly like a
clean run. So `scripts/biomeTestOverride.test.ts` runs the real `biome.jsonc` over two
fixtures holding identical code under two names, and asserts three things: the rules fire in
`probe.ts`, they are quiet in `probe.test.ts`, and a money violation in `probe.test.ts` is
**still** reported. The last is the one that matters — it is the difference between an
override and Biome skipping the suite.

The other seven rules need no fixture: their headers are gone from ~60 files, so removing any
one from the override fails `bun run lint` on the files that needed it. The suite is its own
pin.

## What it cost

Two per-file reasons were folded into category ones and are no longer written down:
`gate.test.ts` explaining that it is long because of the loopback `Bun.serve` + Better Auth +
PGlite harness, and `biomePlugins.test.ts` explaining its single magic number. Both were true
and neither changes a decision; the file docstrings still explain the harnesses themselves.
That is the trade: 137 lines of repeated prose for two lines of specific prose.

## Rejected

- **Leaving it inline, per ADR 0012.** The honest version of this option is "accept that 137
  suppressions are never read". The rule was written to make exceptions auditable, and at 58
  copies of one sentence it had begun to do the opposite.
- **Excluding test files from Biome entirely** (`!**/*.test.ts` in `files.includes`). One
  line, and it would take the `.biome/plugins` bans with it — including `no-mocks.grit`,
  whose entire subject is test files. `.claude/rules/tests.md` would lose its only mechanical
  enforcement, silently.
- **Moving every rule the suites suppress**, all 32, into the override. It would delete more
  prose, and it would put the repo-wide reasons (`noUnsafeTypeAssertion`, `useExplicitType`,
  `useTopLevelRegex`) in two places at once: the config for tests, the file for source. Two
  owners of one reason is the drift this repo avoids everywhere else.
- **An `ast-grep` rule instead.** ast-grep cannot switch a Biome rule off; it could only
  refuse the headers after the fact. The config is where the decision belongs.

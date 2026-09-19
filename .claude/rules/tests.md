---
description: Real implementations over mocks; a guard needs two tests
globs: ["**/*.test.ts", "**/*.test.tsx", "**/testing.ts"]
---

# Tests

## NEVER

- **NEVER mock.** No `vi.mock`/`vi.fn`/`vi.spyOn`, no `mock`/`spyOn` from `bun:test`, no
  asserting a function was called. A suite that asserts a mock was called is green whether
  or not the code works. Enforced by `.biome/plugins/no-mocks.grit` for the member-call
  spelling and by `noRestrictedImports` in `biome.jsonc` for the import.
- **NEVER write into the repo from a test.** Use in-memory stores and PGlite.

## Follow

- **Real in-memory implementations over fakes-that-always-answer.** `InMemoryObjectStore`,
  `InMemoryFetcher` (which _refuses_ an unmodelled request), `TestClock`, and PGlite (real
  Postgres in WASM) are the seams. A fake that never refuses makes a broken boundary look
  fine.
- **A guard needs two tests:** one where it fires, one where it stays quiet. A rule with
  only the firing case can be satisfied by code that always throws.
- **A suite runs as the role that runs the code in production.** Seed fixtures as the
  superuser, then `await db.become("undercroft_worker")` (or `"undercroft_app"`) at the end
  of `beforeEach`; plant any later fixture the role may not write through `db.asSuperuser`.
  A repo statement missing a grant then fails in the gate rather than at 02:00 with
  "permission denied for table". Every suite ran as the superuser until release 1.8, and so
  did every service.
- **Assert observable behaviour**, not internals — public values, states, errors.
- **PGlite proves the grants are correct**, not that a hostile connection cannot escalate
  past `SET ROLE`; that, and `FOR UPDATE` concurrency, are integration-tier against real
  Postgres.
- The offline gate (`bun run verify`) must pass with no Docker, no network, no credentials.
- **Never paste a `biome-ignore-all` header into a suite** — it is banned here exactly as in
  source, and `bun run lint:rules` fails on one. The twelve rules whose answer is "because it
  is a test" — `noBunModules`, `useExpect`, `noSecrets`, `useTopLevelRegex`,
  `noUnsafeTypeAssertion`, the two length rules and five more — are answered once in the
  `biome.jsonc` override for `**/*.test.ts(x)`, and a copy in the file is dead prose the next
  reader still has to check. A rule that fires for a reason about _this_ suite gets a
  **line-level** `// biome-ignore` carrying that reason, which Biome reports the day it stops
  being needed. ADR 0017 and ADR 0022.

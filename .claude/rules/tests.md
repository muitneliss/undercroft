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
- **Assert observable behaviour**, not internals — public values, states, errors.
- **PGlite proves the grants are correct**, not that a hostile connection cannot escalate
  past `SET ROLE`; that, and `FOR UPDATE` concurrency, are integration-tier against real
  Postgres.
- The offline gate (`bun run verify`) must pass with no Docker, no network, no credentials.

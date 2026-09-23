---
description: Real implementations over mocks; a guard needs two tests
paths: ["**/*.test.ts", "**/*.test.tsx", "**/testing.ts"]
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
- **A suite that needs the schema opens `createMigratedTestDatabase()`**, not
  `createTestDatabase()` followed by `migrate()`. Booting PGlite is `initdb` in WASM, about
  0.2s, and one boot per test was 99% of the unit gate's runtime; the migrated fixture boots
  once per process and restores every later database from a snapshot in about 60ms. Each test
  still gets its own database. Only a suite testing `migrate` itself wants the empty one.
- **A test that never touches the database does not sit under a `beforeEach` that opens
  one.** Put it in its own `describe` or file; a pure function pays nothing for a fixture it
  does not use.
- **Files run in parallel** (`bun test --parallel`, one process per core, each file in a
  fresh global). A suite owns its own temp directory, port and database; it may not depend on
  another file having run first.
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

# Contributing to Undercroft

Thanks for your interest. Undercroft is early; the architecture is settling, so an issue to
discuss a direction is welcome before a large PR.

## Setup

You need Bun (the version in `.bun-version`), [Task](https://taskfile.dev), and, for the local
stack and the integration tier, Docker and Python 3 (the local dbt virtualenv).

```sh
bun install
task ci:verify    # the gate: typecheck, lint, rules, format, spec validation, SPA build, tests
```

Every operation goes through [Task](https://taskfile.dev) — `task --list-all` enumerates
them, and `.claude/rules/tooling.md` says why a bare `bun run` is not the way in. `ci:verify`
must pass with no Docker, no network and no credentials; `task ci:itest` adds the
Docker-backed integration tier, which needs `deploy/compose/.env` and Postgres.

CI also runs checks outside the gate: `ci:cli-pack-check` (Node 22 and npm),
`ci:skill-check` (network), `ci:compose-check` (every service in both compose files declares
a memory limit) and `ci:secrets-check`. Run the ones your change touches.

## Ground rules

- **Read the rule files.** `.claude/rules/*.md` are short and load automatically for Claude
  Code; if you use another agent, read the ones matching the files you touch. They encode
  decisions that a passing gate cannot check — never guessing a value, create-only lake
  writes, the privilege boundary.
- **Money is a string.** Never `Number()` an amount. The lint rule that fires is right.
- **No mocks.** Use the real in-memory implementations (`InMemoryObjectStore`,
  `InMemoryFetcher`, PGlite). A guard needs two tests: one where it fires, one where it
  stays quiet.
- **No customer data in git.** Synthetic fixtures, CASE-ids, no real names. See
  `.claude/rules/pii.md`.

## Commits

Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`). Decisions
go in `docs/adr/` as a new numbered file; a reversal supersedes rather than edits.

## What makes a good PR

A clear problem statement, the smallest coherent change, tests that pin a real promise (not
coverage for its own sake), and a green gate. If you change a lake or privilege invariant,
change its test deliberately and say why in the commit.

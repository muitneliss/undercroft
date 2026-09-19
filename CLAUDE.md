# Undercroft — working conventions

> `AGENTS.md` is a **symlink to this file**, so every agent reads the same rules and they
> cannot drift apart. Edit `CLAUDE.md`; never replace the symlink with a copy.

Read this before changing anything. It is short on purpose and it is a **map**: the
enforceable detail lives in `.claude/rules/`, one file per concern, and the reasoning
lives in `docs/adr/` and in module docstrings next to the code they constrain.

## What this is

A generic data platform. Any REST source → an immutable raw lake on S3/MinIO → one
generic table in Postgres → user-authored dbt models → any BI tool.

It ships **no business schema**. If you find yourself writing a `customers` table, stop:
that belongs in a user's dbt project, not here.

## The three rules that matter most

1. **Raw is the only durable layer.** Everything in Postgres is a projection and may be
   dropped and rebuilt. Raw cannot be recomputed.

2. **Never guess; return nothing and say why.** An empty cell is visibly missing; a wrong
   value is invisibly false. "No evidence" is never "pass". This governs _values_:
   `money.ts` refuses to guess an amount, and a row the pipeline refuses is recorded with
   its reason rather than dropped.

3. **One writer, many callers.** Every byte enters through `LakeStore`'s create-only path.
   The REST lake API is a caller, not a second writer.

## Rules

`.claude/rules/*.md` are path-scoped: each loads when a matching file is opened, which is
the moment its rule actually bites. **Claude Code discovers these automatically. Other
agents do not — if you are not Claude Code, read the ones matching the files you are
about to touch.** That is the only reason this index exists.

| Rule file       | Applies to                                  | Governs                                                                                  |
| --------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `money.md`      | everywhere                                  | money as a string, `big.js` never `number`, three-valued comparison, missing is not zero |
| `raw-lake.md`   | `packages/lake/**`                          | create-only writes, idempotent by content, retention bounded and reported                |
| `connectors.md` | `packages/connector-runtime/**`, `specs/**` | the spec contract; a failure raises, never an empty stream                               |
| `privileges.md` | `packages/db/sql/**`                        | the role and grant model; why the BI role cannot read `raw`                              |
| `tests.md`      | `**/*.test.ts`                              | real in-memory implementations over mocks, a guard needs two tests                       |
| `state.md`      | `apps/ui/**`                                | client state in the Zustand store, server state in tRPC hooks; `useState` is banned      |
| `i18n.md`       | `apps/ui/**`, `apps/control-plane/src/**`   | Vietnamese default, English second; no user-facing string written in place               |
| `layering.md`   | `apps/*/src/**`, `packages/db/src/**`       | one direction: handler → service → repo; SQL only in repos; dependencies injected        |
| `pii.md`        | `specs/**`, `docs/**`, `*.md`, fixtures     | no real customer data in any tracked file                                                |
| `deployment.md` | `deploy/**`, `flows/**`, deploy workflows   | the Dokploy API is the only channel, every service declares a memory limit               |

## Language and runtime

**TypeScript only.** There is deliberately no Python in this repo's source. dbt is a
Python program, but it is an _invoked dependency in its own container_ — the same
category as Postgres or Kestra. We never import it, ship it, or maintain it.

Bun is the runtime, package manager, workspace manager and test runner. One toolchain;
adding a second is how two definitions of green drift apart.

## The gate

`bun run verify` — typecheck, lint, format check, the SPA build, then the test suite. It
must pass with **no Docker, no network and no credentials**. `bun run itest` is the
Docker-backed tier and is deliberately separate.

`bun run build:ui` is in the gate because `tsc` cannot see what a bundler refuses. Importing
a module that reaches a Node built-in — `@undercroft/core`'s root barrel pulls `node:crypto`
through `ids.ts` — typechecks perfectly and fails Rollup outright, and without this step the
first thing to notice would be the release image build, long after the merge. That is why
the browser imports `@undercroft/core/locale` rather than the barrel.

**A green `verify` is not evidence that the rules above held.** A linter cannot see "never
guess", create-only lake writes, or the one-writer rule; the rule files are their only
enforcement. Treating green as proof would be rule 2 broken by the harness itself.

Some rules are the exception, because a machine _can_ see them, and each is pinned from both
sides — fires, and stays quiet — so it cannot quietly stop matching:

- `no-usestate` and the `layer-*` rules are **ast-grep** rules that fail `bun run lint:rules`.
  Pinned by `scripts/layering.test.ts`.
- The money bans, the no-mock bans and the UI's type-only import of the server router are
  **Biome GritQL plugins** in `.biome/plugins/`, which fail `bun run lint`. Pinned by
  `scripts/biomePlugins.test.ts`. They are plugins because Biome ships no
  `no-restricted-syntax`; see ADR 0012.

Where a rule can be made mechanical it is.

**Biome is the linter and the formatter**, at `preset: "all"` — every rule it ships, at
error severity, with every domain on. Where a rule cannot apply here it is suppressed at the
file it applies to, with the reason written beside it, so a reviewer can check each one and
delete it when it stops being true. Prettier is kept for Markdown and YAML alone, the two
languages Biome cannot format.

**One exception, and it is scoped to test files.** Ten rules whose whole answer is "because
it is a test" — `noBunModules`, `noMagicNumbers`, `useExpect`, the two length rules, and five
more — are switched off once, in the `biome.jsonc` override for `**/*.test.ts(x)`, rather
than in every suite. The same sentence pasted into 58 files is not one a reviewer re-reads,
and it cannot be deleted when it stops being true. Anything else argues for itself at the
file, in a test exactly as in a source file. ADR 0017 supersedes that paragraph of ADR 0012;
`scripts/biomeTestOverride.test.ts` pins the boundary from both sides.

## Deploying

One Dokploy raw-compose stack on `lowbit.link`; the control plane and Metabase are the only
public surfaces. Merging the release-please PR cuts a tag, which builds the images and
deploys them — nothing else does. The Dokploy API is the only channel for a change (SSH is
read-only), and `scripts/dokploy.ts` verifies a rollout landed rather than trusting
Dokploy's `done`. See `.claude/rules/deployment.md`, `docs/runbook/deployment.md`, and
ADR 0008.

## Conventions

- `docs/adr/NNNN-topic.md` for decisions. Status, date, the options rejected and why.
  Immutable once accepted — a reversal gets a **new** ADR superseding the old one. We
  never edit a decision to look like it was always different, because then the reasoning
  that produced it is lost.
- Module docstrings explain _why_, especially where the code refuses to do the obvious
  thing. A constraint with no recorded reason gets "simplified" away by the next reader.
- Lint rules that fight the codebase get disabled **with a written reason**, not worked
  around file by file.
- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).

## Wiki / Context

This project has an LLM-maintained wiki under `wiki/`. You MUST NOT hand-edit
wiki docs (`wiki/sources`, `wiki/notes`, `index.md`, `log.md`) — they are
managed by the Ymir wiki CLI and a PreToolUse hook blocks direct edits. See
`wiki/SCHEMA.md` for the rules and command reference.

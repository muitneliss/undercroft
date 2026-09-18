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

`bun run verify` — typecheck, lint, format check, then the test suite. It must pass with
**no Docker, no network and no credentials**. `bun run itest` is the Docker-backed tier
and is deliberately separate.

**A green `verify` is not evidence that the rules above held.** ESLint cannot see "never
guess", create-only lake writes, or the one-writer rule; the rule files are their only
enforcement. Treating green as proof would be rule 2 broken by the harness itself.

Two rules are the exception, because a machine _can_ see them: `no-usestate` and the
`layer-*` rules are ast-grep rules that fail `bun run lint:rules` inside the gate. Where a
rule can be made mechanical it is, and `scripts/layering.test.ts` pins each of those guards
from both sides so the rule cannot quietly stop matching.

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

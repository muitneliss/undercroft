# 23. Task is the mandatory command entrypoint

- Status: Accepted
- Date: 2026-09-19

## Decision

Every operation in this repo — starting the local stack, building an artifact, the gate,
deploying, a migration — is invoked as `task <namespace>:<name>`, defined in a
[Task](https://taskfile.dev) file. The root `Taskfile.yml` only declares `version`,
`output`, `dotenv` and five `includes`, one per concern:

```
Taskfile.yml
.taskfiles/
  dev/Taskfile.yml        the local stack: bring it up, run it, reset it
  artifacts/Taskfile.yml  artifacts: the SPA bundle, generated assets/schemas, local images
  ci/Taskfile.yml         the gate and its individual steps
  cd/Taskfile.yml         scripts/dokploy.ts, one task per subcommand
  db/Taskfile.yml         DSN-parameterised migrate/invite
```

A task's `cmds:` calls the existing `package.json` script or `scripts/*.ts` file — it does
not re-implement it. Task is the one place every operation is enumerated
(`task --list-all`) and the one way anyone (a contributor, an agent, CI) invokes one; it is
not a second definition of what any step does. `.claude/rules/tooling.md` is the enforcement
surface for this; there is no mechanical gate for it the way `layer-*` or the money bans have
one, because there is no static property to check "did a human type `bun run verify` instead
of `task ci:verify`" after the fact.

`.github/workflows/ci.yml` and `deploy.yml` install Task (`go-task/setup-task@v1`) and call
`task ci:verify` / `task cd:<cmd>` instead of the bun/script commands directly, so CI runs
the exact command a contributor runs locally.

## Why

Before this, "everything you can do to this repo" was scattered across `package.json`
scripts, `scripts/*.ts`, two runbooks and four workflow files, each describing a slightly
different slice from a different angle. Two symptoms of that, both real:

- **Local dev needed two hand-populated terminals.** `docs/runbook/sign-in-setup.md`'s
  Path B — the only way to get hot reload, since Path A rebuilds a Docker image per change —
  was `docker compose up -d postgres`, then paste a decreasing DSN into one terminal running
  the control plane by hand, then `cd apps/ui && bun run dev` in a second. Getting the DSN,
  the ports and the public URL right was on the reader every time.
- **CI and "what a developer runs" could already say two different things** and nothing
  would notice until they actually diverged. `bun run verify` typed by a contributor and
  `bun run verify` in `ci.yml` happened to be the same string, but nothing enforced that; a
  workflow edited to add a flag, or a contributor running a slightly different local
  incantation, would drift silently.

Task's `dev:*` namespace collapses the two-terminal dance into `task dev:run`: infra in
Docker, the three apps native with `bun --watch` / Vite's own HMR, one process tree Ctrl+C
stops cleanly. The `ci:*`/`cd:*` namespaces make "what CI runs" and "what an operator types"
the identical command, `task ci:verify` / `task cd:deploy TAG=...`, so there is exactly one
place either is defined.

This is the same reasoning `CLAUDE.md`'s "Bun is the one toolchain" already applies one layer
down, moved up a level: **Task is the second toolchain this repo is willing to add**, because
without an orchestration layer, "how do I run this" answers differ by who's asking and stay
that way until someone notices.

## Rejected

- **A Makefile.** No namespacing (`make dev-run` vs `task dev:run` reads the same, but Make
  has no `includes:`-with-`dir:` mechanism to split targets across files without every target
  fighting over one flat namespace and one working directory). No `dotenv:`, no `requires:`
  for a task like `cd:deploy` that needs a `TAG`, no `run: once` to de-duplicate a shared
  setup step fanned out to several parallel targets — all of which `dev:run` actually needs.
- **Deeper `package.json` scripts** (`"dev:run": "concurrently ...", "dev:api": "..."`).
  `concurrently` (or similar) is a third piece of tooling on top of Bun for exactly the one
  thing — running several long-lived processes and labelling their output — that Task
  already does via parallel `deps:` and `output: prefixed`. It also can't express `dev:run`'s
  shape at all: infra up, then migrate, then fan out three servers in parallel, blocking
  until Ctrl+C, without a second script language (`concurrently`'s own flag syntax) bolted
  onto `npm`'s.
- **A bag of `scripts/*.sh` files**, one per operation. No shared namespace to discover them
  by (`ls scripts/` mixes shell scripts with the existing `scripts/*.ts` utilities and
  test-pinned modules), no built-in var/dotenv layering, and every script re-solves "what
  directory do I assume I'm run from" independently — which is exactly the class of bug
  `dir: '{{.ROOT_DIR}}'` on every Task include exists to remove structurally.
- **Leaving `bun run <x>` as the sanctioned interface and only adding `task dev:run`.**
  Half-measures keep the two-definitions-of-green problem for everything except local dev:
  CI would still be free to drift from "what a developer runs" for the gate and for deploys,
  which is the failure mode namespacing `ci:*`/`cd:*` exists to close.

## What it cost

Two apps gained a `"dev"` script they didn't have (`apps/worker/package.json`,
`apps/control-plane/package.json`: `bun --watch src/<entry>.ts`), so Task's `dev:api` /
`dev:worker` can call `bun run --filter '@undercroft/<app>' dev` the same way `build:ui`
already calls `--filter '@undercroft/ui' build`, rather than hardcoding an entry path in the
Taskfile. Running dbt outside its Docker image (ADR 0007) needed a real answer rather than a
gap: `dev:worker` depends on `dev:dbt-setup`, which provisions a local Python venv pinned to
the same `dbt-core`/`dbt-postgres` versions `deploy/Dockerfile.worker` bakes in. That is a
genuinely new local prerequisite (Python) for anyone who wants the worker's transform step to
run outside Docker — unavoidable short of running the worker in Docker too, which would cost
hot reload back.

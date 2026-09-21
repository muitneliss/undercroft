---
title: ADR 0023 Task Is the Mandatory Command Entrypoint
type: source
date: 2026-09-21
tags: []
source: docs/adr/0023-task-is-the-mandatory-command-entrypoint.md
source_path: docs/adr/0023-task-is-the-mandatory-command-entrypoint.md
source_hash: 95e3619cf46bd78b823009f12aa09cd17d3ab119f7a59216fff3ffb6bf793bc6
ingested: 2026-09-21
---

# ADR 0023 Task Is the Mandatory Command Entrypoint

Every operation in this repo -- starting the local stack, building an artifact, the gate, deploying, a migration -- is invoked as `task <namespace>:<name>`. The root `Taskfile.yml` declares only `version`, `output`, `dotenv` and five `includes`, one per concern: `.taskfiles/dev/` (the local stack), `artifacts/` (the SPA bundle, generated assets and schemas, local images), `ci/` (the gate and its individual steps), `cd/` (`scripts/dokploy.ts`, one task per subcommand) and `db/` (DSN-parameterised migrate and invite). A task's `cmds:` calls the existing `package.json` script or `scripts/*.ts` file and does **not** re-implement it, so Task is the one place every operation is enumerated (`task --list-all`) and the one way anyone invokes one -- never a second definition of what a step does.

There is deliberately no mechanical gate for this, unlike the `layer-*` rules or the money bans, because there is no static property that can check whether a human typed `bun run verify` instead of `task ci:verify` after the fact. `.claude/rules/tooling.md` is the enforcement surface. `.github/workflows/ci.yml` and `deploy.yml` install Task via `go-task/setup-task@v1` and call `task ci:verify` / `task cd:<cmd>`, so CI runs the exact command a contributor runs locally.

Why: "everything you can do to this repo" had been scattered across `package.json` scripts, `scripts/*.ts`, two runbooks and four workflow files, each describing a slightly different slice. Two real symptoms. Local dev needed two hand-populated terminals -- the hot-reload path in [[Runbook Sign-In Setup]] was `docker compose up -d postgres`, then a hand-pasted DSN into one terminal, then `cd apps/ui && bun run dev` in a second, with the ports and public URL on the reader every time. And CI and "what a developer runs" could already say two different things with nothing to notice: the two `bun run verify` strings happened to match, but nothing enforced it, so a workflow edited to add a flag would drift silently. `task dev:run` collapses the first into one process tree; the `ci:*` / `cd:*` namespaces make the second one command. This is `CLAUDE.md`'s "Bun is the one toolchain" argument moved up a level -- **Task is the second toolchain this repo is willing to add**, because without an orchestration layer "how do I run this" answers differently depending on who is asking.

Rejected: a Makefile, which has no `includes:`-with-`dir:` to split targets without one flat namespace and one working directory, no `dotenv:`, no `requires:` for a task like `cd:deploy` that needs a `TAG`, and no `run: once` to de-duplicate a setup step fanned out to parallel targets -- all of which `dev:run` actually needs; deeper `package.json` scripts, which would add `concurrently` as a third piece of tooling for the one thing Task already does and still could not express `dev:run`'s shape; a bag of `scripts/*.sh`, with no shared namespace to discover them by and every script re-solving which directory it assumes, the bug `dir: '{{.ROOT_DIR}}'` removes structurally; and leaving `bun run <x>` sanctioned while adding only `task dev:run`, a half-measure that keeps the two-definitions-of-green problem for the gate and for deploys.

Cost: two apps gained a `"dev"` script they did not have, so `dev:api` and `dev:worker` can call `bun run --filter` rather than hardcoding an entry path. Running dbt outside its Docker image ([[ADR 0007 dbt Runs as a Subprocess in the Worker]]) needed a real answer rather than a gap, so `dev:worker` depends on `dev:dbt-setup`, which provisions a local Python venv pinned to the versions `deploy/Dockerfile.worker` bakes in -- a genuinely new local prerequisite, unavoidable short of running the worker in Docker and losing hot reload.

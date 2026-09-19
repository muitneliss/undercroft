# Task is the only entrypoint

Every operation in this repo — dev, build, the gate, deploy, a migration — is invoked as
`task <namespace>:<name>`. `bun run <x>`, `bun test`, `docker compose`, and a bare
`bun run scripts/*.ts` are implementation details Task calls into, not things a human or an
agent types. A command that exists but has no task wrapping it does not exist yet.

This matters here specifically because `## The gate` already leans on one definition of
green — `task ci:verify` wrapping the one `bun run verify` — and a second, undocumented way
to run the same check (typing the bun command directly, or a slightly different flag) is
exactly how that definition drifts in two places at once. ADR 0023 records why Task and not
a Makefile, an npm script tree, or a bag of `scripts/*.sh`.

## NEVER

- **NEVER type `bun run <script>`, `bun test`, `docker compose ...`, or
  `bun run scripts/*.ts` directly** once a task wraps it. Use the `task` command; if none
  exists yet, add one in the matching namespace first (see the table below), then use it.
  This applies to Claude Code itself as much as to a human — do not shortcut past the
  Taskfile because a one-off bun command feels faster in the moment.
- **NEVER re-implement a check or a build step's logic inside a Task task.** A task's `cmds:`
  calls the existing `package.json` script or `scripts/*.ts` file. Writing the pipeline
  twice — once in `package.json`, once as inline shell in a Taskfile — is the "two
  toolchains" failure `CLAUDE.md`'s "Language and runtime" section already warns about, just
  moved one layer up.
- **NEVER add a new bun script, `scripts/*.ts` file, or CI step without adding or extending a
  Task task in the same change.** `.github/workflows/*.yml` calls `task ci:*` / `task cd:*`
  precisely so CI and a local run share one command; a workflow step added straight to the
  YAML without a matching task reintroduces the second definition of green.
- **NEVER hand-roll the local stack** (typing `docker compose up`, then `bun run` in two
  terminals with hand-copied env vars). `task dev:run` is that sequence, automated; if it is
  missing something the stack needs, extend it rather than stepping around it.

## Follow

- **Namespaces are operations, not features**: `dev:*` (`.taskfiles/dev/`) the local stack,
  `build:*` (`.taskfiles/artifacts/`) artifacts, `ci:*` (`.taskfiles/ci/`) the gate and its
  individual steps, `cd:*` (`.taskfiles/cd/`) `scripts/dokploy.ts`, `db:*`
  (`.taskfiles/db/`) DSN-parameterised migrate/invite for a database that isn't the local
  one. A task that doesn't fit one of these cleanly is a sign the namespace list is
  incomplete, not a reason to force it sideways — raise it rather than guessing.
- **`task --list-all` before you add anything.** It is the one place every operation is
  enumerated; check it before assuming a script needs writing from scratch.
- **Every include sets `dir: '{{.ROOT_DIR}}'`** in the root `Taskfile.yml`, so a task's
  commands are always repo-root-relative regardless of which `.taskfiles/*/Taskfile.yml`
  defines it. `dotenv:` can only be declared in the root Taskfile (Task refuses it in an
  included one) — it lives there even though only `dev:*` currently uses it.
- **A task that needs local secrets reads `deploy/compose/.env`** (loaded once, at the
  root, via `dotenv:`) rather than inventing a second env file. Re-derive a container
  hostname (`postgres`, `minio`, `kestra`) as `localhost:<mapped port>` for anything that
  runs natively instead of in compose — the mapped ports are the same `UNDERCROFT_PORT_*`
  variables `docker-compose.yml` already binds to `127.0.0.1`.
- **An idempotent setup step (`dev:migrate`, `dev:kestra-flows`, `dev:dbt-setup`, `dev:up`,
  `dev:env`) is `run: once`.** `dev:run` fans three tasks out in parallel that all depend on
  a couple of these; without `run: once` Task has no reason not to run each dependency again
  for every task that lists it, and two `bun run migrate` processes racing the same
  connection is a failure mode worth not having.
- **CI installs Task via `go-task/setup-task@v1`**, alongside `oven-sh/setup-bun@v2` in any
  job whose tasks shell out to `bun`. A job whose tasks don't touch bun (`ci:compose-check`,
  `ci:secrets-check`) only needs the former.

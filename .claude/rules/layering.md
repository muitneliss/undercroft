---
description: One direction only — handler → service → repo; SQL lives in repos; dependencies are injected
globs:
  [
    "apps/*/src/**/*.ts",
    "packages/db/src/**/*.ts",
    ".ast-grep/rules/layer-*.yml",
    "scripts/layering.test.ts",
  ]
---

# One direction: handler → service → repo

A file's **directory is its layer**. Moving code between layers is a rename, which is a
thing a reviewer sees; a comment claiming a layer is not.

```
apps/*/src/
  main.ts | server.ts   the composition root: reads env, builds the pool, wires it up
  handlers/             HTTP, tRPC, status codes. Validate input, call ONE service, map the result
  services/            the decisions. Values in, values out. No transport, no SQL
  repos/               every statement, one module per table group

packages/db/src/        the seam (SqlExecutor, pool, migrate) + its own repos/ and services/
packages/{core,contracts,crypto,lake,connector-runtime}/   below every layer
```

Enforced by `.ast-grep/rules/layer-direction.yml` and `layer-coupling.yml`, which run in
`bun run lint:rules` and therefore in `bun run verify` and CI. Each guard is pinned from
both sides — fires, and stays quiet — in `scripts/layering.test.ts`. The reasoning is in
`docs/adr/0011-layers-handler-service-repo.md`.

## NEVER

- **NEVER import upward or skip a layer.** A handler calls a service, never a repo
  (`layer-handler-no-repo`). A service never imports a handler, a repo never imports either
  (`layer-service-no-upward`, `layer-repo-no-upward`). A shared package imports no layer at
  all (`layer-shared-no-layer`).
- **NEVER write SQL outside `repos/`** (`layer-sql-in-repos`). A `SELECT` in a handler
  couples the transport to the schema, so a column rename becomes an HTTP change — and it is
  how an authorization check drifts away from the query it was meant to guard. The three
  exemptions (`migrate.ts`, `pool.ts`, `testing.ts`) are written into the rule with reasons.
- **NEVER put `TRPCError`, `hono`, or a status code in a service.** Return a value, or
  `null`, or a tagged result (`{ ok: false, reason: "already-member" }`). The handler decides
  what that means over HTTP. A service that throws `TRPCError` is callable from exactly one
  caller.
- **NEVER read `process.env` or construct infrastructure below the entrypoint**
  (`layer-injected-deps`). No `createPool`, no `new S3ObjectStore`, no `new LakeStore` inside
  a layer. Ambient configuration cannot be substituted by a caller, and a pool built inside a
  layer is a hidden singleton nobody can close.
- **NEVER import `pg` or PGlite outside their seam** (`layer-no-driver-import`). Repos speak
  `SqlExecutor`; that is what lets the same repo run against a real pool in production and
  against Postgres-in-WASM in the offline gate.

## Follow

- **A repo takes `SqlExecutor` as its first argument** and returns rows or `null`. It
  decides nothing: `roleFor` answers with a role or `null`, and whether that is a 404 is
  argued one layer up, in `handlers/trpc.ts`, once.
- **A service takes its dependencies as arguments** — the `deps` pattern already in
  `RunDeps`, `LakeApiDeps` and `ServerDeps`. Anything it needs to _do_ (send an email, notify
  an invitee) arrives as a function, so the decision is testable without the thing it drives.
- **One repo per table group**, named for the tables: `invitation.ts`, `membership.ts`,
  `rawRecords.ts`. A cross-table read query is named for the question it answers
  (`isKnownOrInvited`).
- **A guard belongs in SQL when concurrency matters.** The `raw.records` upsert enforces
  "idempotent" and "no time travel" in the statement, not in the loader, because a check in
  application code only binds the one loader that runs it. `.claude/rules/raw-lake.md`.
- **Tests are exempt from all of this.** A test is a composition root: it wires the layers it
  exercises and seeds fixtures with whatever is convenient. Every rule ignores `**/*.test.ts`,
  deliberately.
- **A new endpoint is four small edits**, in this order: repo function → service decision →
  handler procedure → test through the public seam. If a step has nothing to add, it is still
  the place where the next change will go.

---
title: ADR 0011 Layers Are Directories, Handler to Service to Repo
type: source
date: 2026-09-18
tags: []
source: docs/adr/0011-layers-handler-service-repo.md
source_path: docs/adr/0011-layers-handler-service-repo.md
source_hash: 7d2a2ebef0153b20f1a7aed3c9a84d297ca80260c38f16e22b198b64de8cee55
ingested: 2026-09-18
---

# ADR 0011 Layers Are Directories, Handler to Service to Repo

## Decision

Every app and `packages/db` is organised into three layers, and **a file's directory is its
layer**:

```
apps/*/src/
  main.ts | server.ts   the composition root: env, pool, object store, wiring
  handlers/             HTTP, tRPC, status codes
  services/             the decisions
  repos/                every SQL statement, one module per table group
```

Dependency arrows point one way — `handlers/` → `services/` → `repos/` — and nothing skips
a step. A handler may not import a repo; a service may not import a handler or a transport
library; a repo may not import either; the shared packages may import no layer at all.

Three further constraints make the arrows mean something:

* **SQL only in `repos/`**, with three written exemptions: `migrate.ts`, `pool.ts`,
  `testing.ts`.
* **Dependencies arrive as arguments.** No `process.env`, no `createPool`, no
  `new S3ObjectStore`/`new LakeStore` inside a layer.
* **The driver stays behind its seam.** `pg` in `pool.ts`, PGlite in `testing.ts`.

Seven ast-grep rules enforce all of it in `bun run lint:rules`, inside `bun run verify` and
CI. `scripts/layering.test.ts` pins each guard from both sides.

## Why

* **The direction was already implicit and already broken.** The tRPC router ran SQL in nine
  places and imported repo functions directly. So the transport knew the schema: a column
  rename was an HTTP change, and the 404-not-403 boundary — the most security-relevant
  decision in the control plane — sat beside the query it was meant to guard instead of
  above it.
* **A convention no machine checks is a convention that lasts until the next deadline.**
  The repo already made this call for `useState` in
  [[ADR 0009 UI State in Zustand, useState Banned]]. It applies more strongly here, because
  a layering violation is invisible in review — an import line looks like every other one.
* **Directories over filename suffixes.** The same signal in the file tree, in an import
  path and in a reviewer's diff, and it gives each layer an obvious home for the next file.
* **Services return values, not `TRPCError`s.** That is what makes decisions reusable from a
  CLI, a job or a backfill, and keeps status-code choices in one file.
* **Injected dependencies are why the gate needs no Docker.** Banning `process.env` and
  in-layer construction protects that property rather than leaving it a habit.

## Consequences

* **`@undercroft/db` gained `./repos` and `./services` subpath exports.** Behind a single
  barrel, a handler importing a repo and a handler importing the executor type are the same
  import statement, and no rule can tell them apart.
* **`bun run lint:state` is now `bun run lint:rules`.** ADR 0009 refers to the old name and
  is left as written — an accepted ADR records what was decided then.

## Rejected

* **ESLint `no-restricted-imports` with zone patterns.** Expresses the import direction and
  nothing else — not "SQL only in repos", not "no `process.env` below the entrypoint".
* **Filename suffixes.** The layer then lives in a fragment of a filename a rename can drop.
* **A comment-only convention, or a CLAUDE.md paragraph.** The violation is invisible in
  review.
* **Treating the whole of `packages/db` as "the repo layer".** The package holds the seam
  every layer may depend on; collapsing the two would make `SqlExecutor` unimportable from a
  handler.
* **Making tests obey the rules.** A test is a composition root; every `layer-*` rule
  ignores `**/*.test.ts` deliberately.

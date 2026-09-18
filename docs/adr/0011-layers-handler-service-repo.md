# 11. Layers are directories: handler → service → repo, enforced by ast-grep

- Status: Accepted
- Date: 2026-09-18

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

The dependency arrows point one way — `handlers/` → `services/` → `repos/` — and nothing
skips a step. A handler may not import a repo; a service may not import a handler or a
transport library (`hono`, `@trpc/server`); a repo may not import either; the shared
packages (`core`, `contracts`, `crypto`, `lake`, `connector-runtime`) may import no layer at
all.

Three further constraints make the arrows mean something:

- **SQL only in `repos/`**, with three written exemptions: the migration runner
  (`migrate.ts`), the `pg` seam (`pool.ts`) and the PGlite seam (`testing.ts`).
- **Dependencies arrive as arguments.** No `process.env`, no `createPool`, no
  `new S3ObjectStore`/`new LakeStore` inside a layer; the composition root does that.
- **The driver stays behind its seam.** `pg` is imported by `pool.ts` and PGlite by
  `testing.ts`, nowhere else.

Seven ast-grep rules (`.ast-grep/rules/layer-direction.yml`, `layer-coupling.yml`, ids
prefixed `layer-`) enforce all of it in `bun run lint:rules`, inside `bun run verify` and CI.
`.claude/rules/layering.md` carries the convention for humans and agents, symlinked to
`apps/AGENTS.md` and `packages/db/AGENTS.md` so an agent that does not read `.claude/rules`
finds the same bytes where the rule bites — the arrangement ADR 0009 set up for
`apps/ui/AGENTS.md`. `scripts/layering.test.ts` pins each guard from both sides, with a
violating and a compliant fixture in a throwaway project in the temp directory.

Two consequences of the decision are visible in the code:

- **`@undercroft/db` gained `./repos` and `./services` subpath exports.** The root export is
  now the seam alone (`SqlExecutor`, pool, migrate). Behind a single barrel, a handler
  importing a repo and a handler importing the executor type are the same import statement,
  and no rule can tell them apart.
- **`bun run lint:state` is now `bun run lint:rules`.** It always ran every ast-grep rule;
  with layering added, the old name described one of its rules rather than what it does. ADR
  0009 refers to the old name and is left as written — an accepted ADR records what was
  decided then.

## Why

- **The direction was already implicit and already broken.** The tRPC router ran SQL in nine
  places and the tRPC context in one more, and imported repo functions straight out of
  `@undercroft/db`. So the transport knew the schema: a column rename was an HTTP change, and
  the 404-not-403 boundary — the most security-relevant decision in the control plane — sat
  beside the query it was meant to guard instead of above it.

- **A convention no machine checks is a convention that lasts until the next deadline.** This
  repo has already made that call once, for `useState` (ADR 0009): a rule file states the
  intent, an ast-grep rule fails the build. The same reasoning applies more strongly here,
  because a layering violation is invisible in review — an import line looks like every other
  import line.

- **Directories over filename suffixes.** `*.repo.ts` would also have been checkable and
  would have kept the flat layout. A directory was chosen because it is the same signal in
  the file tree, in an import path and in a reviewer's diff, and because it gives each layer
  an obvious home for the next file. The cost is a migration of nearly every backend file,
  paid once, in commits that are pure renames plus extractions.

- **Services return values, not `TRPCError`s.** That is what makes the decisions reusable
  from a CLI, a job or a backfill, and it is what keeps status-code choices in one file
  instead of spread over every procedure. `people.invite` reports `already-member` as a value;
  the router alone knows that is a 409.

- **Injected dependencies are why the gate needs no Docker.** The whole stack already ran
  against PGlite and an in-memory object store because every module took its dependencies as
  arguments. Banning `process.env` and in-layer construction protects the property that makes
  the whole suite runnable with no Docker and no network, rather than leaving it a habit.

## Rejected

- **ESLint `no-restricted-imports` with zone patterns.** It can express the import direction
  and nothing else: not "SQL only in repos", not "no `process.env` below the entrypoint", not
  the `.query` receiver constraint. Two tools for one convention means two places to look
  when it fires, and ast-grep was already the repo's structural linter.

- **Filename suffixes (`*.handler.ts`, `*.service.ts`, `*.repo.ts`).** Equally enforceable,
  smaller diff. Rejected because the layer then lives in a fragment of a filename that a
  rename can drop by accident, and because a flat directory of forty files gives no reader a
  map.

- **A comment-only convention, or a CLAUDE.md paragraph.** Rejected for the reason above: the
  violation is invisible in review.

- **Treating the whole of `packages/db` as "the repo layer".** Tempting, and wrong: the
  package holds the seam (`executor.ts`, `pool.ts`, `migrate.ts`) that _every_ layer may
  depend on. Collapsing the two would have made the seam unimportable from a handler, which
  is where the `SqlExecutor` type belongs.

- **Making tests obey the rules.** A test is a composition root: it wires the layers it
  exercises and seeds rows however is cheapest. Every `layer-*` rule ignores `**/*.test.ts`
  deliberately; the code that ships is what the rules govern.

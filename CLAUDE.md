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

| Rule file         | Applies to                                                               | Governs                                                                                  |
| ----------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `money.md`        | everywhere                                                               | money as a string, `big.js` never `number`, three-valued comparison, missing is not zero |
| `raw-lake.md`     | `packages/lake/**`, the worker's `land*.ts` / `loadToRaw.ts`             | create-only writes, idempotent by content, retention bounded and reported                |
| `connectors.md`   | `packages/connector-runtime/**`, `specs/**`                              | the spec contract; a failure raises, never an empty stream                               |
| `privileges.md`   | `packages/db/sql/**`                                                     | the role and grant model; why the BI role cannot read `raw`                              |
| `tests.md`        | `**/*.test.ts(x)`, `**/testing.ts`                                       | real in-memory implementations over mocks, a guard needs two tests                       |
| `state.md`        | `apps/ui/**`                                                             | client state in the Zustand store, server state in tRPC hooks; `useState` is banned      |
| `i18n.md`         | `apps/ui/**`, `apps/control-plane/src/**`                                | Vietnamese default, English second; no user-facing string written in place               |
| `layout.md`       | `apps/ui/**/*.tsx`, `apps/ui/**/*.css`                                   | a control sits on the line of the field beside it: `row--field`, never a centred `.row`  |
| `layering.md`     | `apps/*/src/**`, `packages/db/src/**`                                    | one direction: handler → service → repo; SQL only in repos; dependencies injected        |
| `pii.md`          | `specs/**`, `docs/**`, `*.md`, fixtures                                  | no real customer data in any tracked file                                                |
| `deployment.md`   | `deploy/**`, `flows/**`, deploy workflows                                | the Dokploy API is the only channel, every service declares a memory limit               |
| `suppressions.md` | every source and test file, `biome.jsonc`, the rule files                | where a lint decision goes; `biome-ignore-all` is banned everywhere, tests included      |
| `tooling.md`      | `Taskfile.yml`, `.taskfiles/**`, `package.json`, `scripts/**`, workflows | Task is the only entrypoint; bun/scripts stay the implementation, never invoked by hand  |

## The assistant

The interleaf (ADR 0029) is a chat panel that reaches the platform's own tRPC procedures. Two
things about it are load-bearing enough to state here rather than only in the ADR:

- **It acts only through `appRouter.createCaller(ctx)`**, so every role gate, the 404-not-403
  boundary and the locale-worded refusals apply unchanged and cannot be re-implemented into
  drift. A tool refuses itself.
- **A mutation needs the reader's struck proof AND the injection gate's agreement.** The
  assistant reads the raw lake, so a tool result carries text written by people outside this
  system; the gate asks a separate model, about the reader's own words with tool results
  excluded, whether they asked for this action. An unconfigured gate DENIES -- one that failed
  open would not be a gate. `docs/runbook/assistant-setup.md` covers turning it on.

## Agents

`.claude/agents/*.md` are two project-local subagents. They own no rules of their own — both
are procedures that send you back to the files above, because normative text with two owners
drifts (the same reason `wiki/tracked.yaml` scopes the wiki to `docs/` and not to the rules).

- **`context-lookup`** (Sonnet) — read-only. Searches the wiki, then confirms the answer at
  the ADR, the rule file or the code, and reports with citations plus the gaps it could not
  close. Use it before contradicting a constraint that looks arbitrary. Retrieval is search
  and quotation rather than judgement, and it runs often, so it does not need the larger model.
- **`undercroft-coder`** (Opus) — implements a change under the rules above and under
  Ousterhout's _A Philosophy of Software Design_: deep modules, information hiding, complexity
  pulled downward, design it twice. Where the book and this repo collide the repo wins, and
  the three collisions that actually come up are written out at the end of its file. It gets
  the larger model because the judgement it makes is the design, and a design mistake here
  survives the review that a wrong quotation would not.

## Language and runtime

**TypeScript only.** There is deliberately no Python in this repo's source. dbt is a
Python program, but it is an _invoked dependency in its own container_ — the same
category as Postgres or Kestra. We never import it, ship it, or maintain it.

Bun is the runtime, package manager, workspace manager and test runner. One toolchain;
adding a second is how two definitions of green drift apart.

## Operations

Every operation goes through [Task](https://taskfile.dev) — never a bare `bun run` or a raw
shell/docker command typed by hand. `task --list-all` enumerates everything that exists; the
surface is split by concern, one Taskfile per namespace under `.taskfiles/`:

| Namespace | Lives in                | Covers                                                                    |
| --------- | ----------------------- | ------------------------------------------------------------------------- |
| `dev:*`   | `.taskfiles/dev/`       | the local stack — `task dev:run` starts all of it, hot reload included    |
| `build:*` | `.taskfiles/artifacts/` | the SPA bundle, generated assets/schemas, local Docker images             |
| `ci:*`    | `.taskfiles/ci/`        | the gate and its individual steps — `task ci:verify` is what CI runs      |
| `cd:*`    | `.taskfiles/cd/`        | `scripts/dokploy.ts`, one task per subcommand                             |
| `db:*`    | `.taskfiles/db/`        | DSN-parameterised migrate/invite, for a database that isn't the local one |

Every `ci:*`/`build:*` task wraps an existing `package.json` script or `scripts/*.ts` file —
Task is the mandated way to invoke it, never a second place that redefines what it does. A
new operation gets a task in the matching namespace before it gets used, the same turn it's
added. See `.claude/rules/tooling.md` and ADR 0023.

## The gate

`task ci:verify` — typecheck, lint, the ast-grep rules, format check, spec validation, the
SPA build, then the test suite (it wraps `bun run verify`: one definition of the gate, Task
is just how you invoke it). It must
pass with **no Docker, no network and no credentials**. `task ci:itest` is the Docker-backed
tier and is deliberately separate.

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

- `no-usestate` and the `layer-*` rules are **ast-grep** rules that fail `task ci:lint-rules`
  (`bun run lint:rules`). The `layer-*` rules are pinned by `scripts/layering.test.ts`;
  `no-usestate` (including its `apps/ui/src/components/ui/**` exemption, docs/adr/0025) is
  pinned separately by `scripts/state.test.ts`.
- `no-biome-ignore-all` is the same kind of rule and bans the lint bypass itself: no
  `biome-ignore-all` **anywhere**, test files included, no group-wide `lint:` /
  `lint/plugin:` spelling (both reach the money plugin), no `ast-grep-ignore` at all. Pinned
  by `scripts/suppressions.test.ts`, whose last two tests run Biome to prove the hole is real.
- The money bans, the no-mock bans, the UI's type-only import of the server router and the
  UI's outright ban on a **model provider** are **Biome GritQL plugins** in `.biome/plugins/`,
  which fail `task ci:lint` (`bun run lint`). Pinned by `scripts/biomePlugins.test.ts`. They
  are plugins because Biome ships no `no-restricted-syntax`; see ADR 0012. The provider ban has
  no type-only carve-out, unlike the router's: the browser needs the router's _shape_ and needs
  nothing at all from `@ai-sdk/anthropic` or `@typesafe-ai/sdk`, which are constructed with an
  API key (ADR 0029).
- `row-field-alignment` is an **ast-grep** rule too, and the one layout defect a machine can
  see: a `.field` written into a centred `.row` hangs the control beside it half a caption
  above the box it acts on, and renders perfectly while doing it. It requires `row--field`,
  whose `:has(> .field)` companion in `index.css` catches the field a linter cannot follow —
  one from a child component or a `.map`. Pinned by `scripts/alignment.test.ts` (the rule,
  and that the two selectors stay one block) and `apps/ui/src/layout.test.ts` (the computed
  value, off the real stylesheet). ADR 0027.

Where a rule can be made mechanical it is.

**Biome is the linter and the formatter**, at `preset: "all"` — every rule it ships, at error
severity. `domains` names the five that apply here — `react` and `tailwind`, both in
`package.json`, plus `project`, `test` and `types`; the other ten are `none`, which costs no
coverage because a Solid rule only ever fires on Solid code.

Where a rule cannot apply here it is answered in `biome.jsonc`, with the reason beside it —
repo-wide when it can never hold, and as a path entry naming the files when it is an
exception, so it stays on everywhere else. **Not** as a header in the source: a
`biome-ignore-all` permits the whole file rather than the line, and Biome never reports one
that has stopped being needed, which is how 17 of the repo's 679 headers came to be dead with
the gate green. `.claude/rules/suppressions.md` and ADR 0018; ADR 0018 supersedes ADR 0012 on
this point. Prettier is kept for Markdown and YAML alone, the two languages Biome cannot
format.

**Tests are a category, not an exception.** Twelve rules whose whole answer is "because it is
a test" — `noBunModules`, `useExpect`, `noSecrets`, `useTopLevelRegex`, the two length rules
and six more — are switched off once, in the `biome.jsonc` override for `**/*.test.ts(x)`,
rather than in every suite. The same sentence pasted into 58 files is not one a reviewer
re-reads, and it cannot be deleted when it stops being true.

A suite that needs something about **itself** writes a line-level `// biome-ignore` with that
reason, which Biome expires by itself. It may not write a `biome-ignore-all`: the exemption
that allowed one held 241 headers, of which 93 were already dead and 134 were the same
sentence in every suite, so closing it cost nothing and shut the door the copies came
through. ADR 0017 supersedes ADR 0012 here and ADR 0022 supersedes ADR 0017;
`scripts/biomeTestOverride.test.ts` pins the boundary from both sides.

## Deploying

One Dokploy raw-compose stack on `lowbit.link`; the control plane is the only public
surface — the Reports division inside it is the BI, and Metabase is gone (ADR 0020).
Merging the release-please PR cuts a tag, which builds the images and deploys them,
Kestra's flows included — nothing else does. The Dokploy API is the only channel for a
change (SSH is read-only), and `task cd:verify` (wrapping `scripts/dokploy.ts`) checks a
rollout landed rather than trusting Dokploy's `done`. A manual deploy or rollback is
`task cd:release TAG=vX.Y.Z`, never a `bun run scripts/dokploy.ts` typed by hand. See
`.claude/rules/deployment.md`, `.claude/rules/tooling.md`, `docs/runbook/deployment.md`, and
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

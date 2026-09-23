# 44. An agent reaches Undercroft as a caller

- Status: Accepted
- Date: 2026-09-23
- Relates to: [ADR 0029](0029-the-assistant-is-an-interleaf.md), whose rule that the assistant
  acts only through the router's own procedures this extends to a process outside the
  control plane.

## Context

LLM agents such as Claude Code, Codex and Cursor, and a person at a terminal, need to do in
Undercroft everything the web UI does, without a browser. The request was explicit on two
points. The CLI must mirror the UI one to one, so an agent has the whole platform to work
with. And it must not be a backdoor: it has to use the architecture that exists, and keep
local, staging and production apart.

The UI does everything through `/trpc` (`apps/ui/src/trpc.ts`). **`appRouter` therefore is
the UI's feature list.** A client that sends the same procedures over the same endpoint with
the person's own session has exactly the UI's capabilities, no more and no less. Every
`tenantProcedure`, `requireRole` and `superadminProcedure` gate applies to it, and so do the
404-not-403 boundary and the localized refusals.

## Decision

### `apps/cli` calls `/trpc` over HTTP, and nothing else

The CLI (`@undercroft/cli`, binary `undercroft`) signs in with the same Better Auth email
one-time code the SPA uses and keeps the session cookie. It sends each command to
`/trpc/<path>` with that cookie. There is no DSN, no service token, no new auth plugin and no
new table.

`.ast-grep/rules/cli-boundary.yml` (`cli-no-backdoor`) forbids its shipped source from
importing any of these by value:

- the control plane;
- the database seam and its drivers;
- `@undercroft/crypto`, the lake, and the connector runtime;
- Better Auth.

`scripts/cliBoundary.test.ts` pins the rule from both sides.

The two sign-in POSTs carry no cookie and no browser fetch metadata. For that case Better
Auth's CSRF check asks for no `Origin`, so the CLI needs no header it would have to fake and
the server's routes did not change. That takes `node:http` rather than `fetch`; see "What
running it found" below.

### The command surface is the router, derived at build time

`apps/cli/scripts/build.ts` imports `appRouter` at build time, never at run time. It walks
`_def.procedures` and converts each procedure's chained zod inputs with `asSchema` from `ai`,
merging them as tRPC does. It bundles the result into the CLI as `virtual:procedures`.

Each dotted path becomes a command mechanically: `bi.questions.save` becomes
`undercroft bi questions save`, and each top-level scalar input becomes a kebab-case flag.
The manifest is never committed, so it cannot drift. `apps/cli/src/cli.test.ts` fails the gate
if the commands and `Object.keys(appRouter._def.procedures)` ever disagree.

The one hand-written table is `apps/cli/src/procedures.ts`. It records each mutation's effect:
`read`, `write` or `destructive`. tRPC's query/mutation split is about HTTP, not about
consequences, so somebody has to write the effects down. The build refuses:

- an unclassified mutation;
- a classification that names a path the router does not have;
- a procedure or topic with no sentence in the catalogue;
- a flag that would collide with a global one.

`lake.query` is classed `write` although it only reads. It runs SQL an admin wrote, which
ADR 0029 kept away from the assistant for the same reason.

### Environments are named profiles, and a session belongs to its origin

`config.json` holds `{ defaultProfile, profiles: { <name>: { url, allowWrites } } }`. The URL
resolves from `--url`, then `UNDERCROFT_URL`, then the chosen profile. The profile is chosen
by `--profile`, then `UNDERCROFT_PROFILE`, then the nearest `undercroft.cli.json`, then the
default. Nothing defaults to localhost: with none of these the answer is `CONFIG_REQUIRED`.

`credentials.json` (mode 0600, written by rename) keys each session by the exact origin that
issued it. A staging login is never sent to production, and `localhost` and `127.0.0.1` are
two origins.

### Writes need a person's decision per environment

The server's role gates are the authority. The CLI adds one decision a person makes, because
the agent driving it may be acting on text somebody else wrote.

- **`allowWrites` is per profile and off by default.** In agent mode it cannot be granted, and
  a profile that has it cannot be pointed at another URL; either attempt returns
  `HUMAN_REQUIRED`. Withdrawing it is allowed, because that only takes authority away.
- **A one-off `--url` never allows writes.**
- **A `write` or `destructive` command on a profile without `allowWrites` returns
  `WRITES_DISABLED`** and never reaches the server.
- **A `destructive` command needs `--yes`** wherever nobody can be asked.
- **`--dry-run` makes no call.** It applies the `allowWrites` check, checks the input's shape
  against the schema, and echoes the request. It claims nothing more, because the server has
  no dry run.
- **There is no idempotency key**, because the server has none.

**The honest limit.** Agent mode is inferred from a non-TTY stdin or stdout. A harness that
deliberately gives an agent a pseudo-terminal defeats the `allowWrites` guard. That risk is
accepted here, in writing. The guard exists for an agent acting on injected text, not for one
whose operator set out to bypass it. The assistant's equivalent is the injection judge;
here it is this per-profile opt-in plus the agent harness's own permission prompts.

### Distribution is a GitHub release asset, installed by the skill

Each release attaches `undercroft-cli-X.Y.Z.tgz`, one bundled Node ES module with no
dependencies. The canonical skill, `skills/undercroft-cli/SKILL.md`, runs
`npx -y --package=<that URL> undercroft …`, so installing the skill
(`npx skills add muitneliss/undercroft --skill undercroft-cli`) is how the CLI is installed.

release-please moved from action inputs to `release-please-config.json` and its manifest. Its
`extra-files` keep the skill's pinned version and `apps/cli/package.json` in step with the
root, and `include-component-in-tag: false` keeps tags `vX.Y.Z` for the image and deploy jobs.
`scripts/skill.test.ts` fails if either version falls behind.

### Two departures from the approved plan, and why

- **`@oclif/core` 5, not 4.** New dependencies are taken at their latest published version,
  and on 2026-09-23 that was 5.0.0. It uses the explicit discovery strategy, as planned. oclif
  documents that it does not support bundling a CLI into one file, because it expects a
  `package.json` and a `bin/run` on disk. The CLI instead hands it the package description in
  memory, through the `pjson` load option, and points the explicit target at the bundle
  itself. `settings.enableAutoTranspile = false` keeps it from looking for TypeScript. The
  runtime floor is Node 22, which `@oclif/core` 5 declares.
- **tRPC's wire is spoken directly, not through `@trpc/client`.** The client and the server are
  released in lockstep: each client version declares an exact peer on the same server version
  and imports run-time helpers from it. The latest client (11.19.0) cannot be bundled against
  the repo's `@trpc/server` 11.0.0. It imports `retryableRpcCodes` and `getTRPCErrorShape`,
  which 11.0.0 does not export. Bumping the server is a change of its own, so
  `apps/cli/src/handlers/remote.ts` sends the non-batched request that 11.0.0's fetch adapter
  reads: a query as GET with `?input=`, and a mutation as a POST with a JSON body. It parses
  `{ result: { data } }` and `{ error: … }`. The suite proves it against the real server.
  **Follow-up:** once the repo upgrades tRPC, the CLI can return to `createTRPCUntypedClient`.

### What running it found, which the gate had not

The plan held, as a verified fact, that Better Auth checks `Origin` only on a request with a
cookie, so a CLI's cookieless sign-in would pass. That is true of `curl`. It is not true of
Node's `fetch`. Undici sends `Sec-Fetch-Mode: cors` on every request and ignores an attempt
to remove it. Better Auth's `validateFormCsrf` reads any `Sec-Fetch-*` header as a browser,
and then demands a trusted `Origin`. Every CLI sign-in against a real server was refused
`MISSING_OR_NULL_ORIGIN`.

The gate could not see this. Unless told otherwise, Better Auth sets `skipOriginCheck` when
`NODE_ENV` is `test`, so every suite, `gate.test.ts` included, ran a laxer server than
production. There are two fixes:

- **The CLI posts its two sign-in requests with `node:http`/`node:https`.** Such a request
  claims to be nothing and takes Better Auth's non-browser branch. Forging an `Origin` was the
  alternative, and it was rejected: it is exactly the header this ADR says the CLI does not
  fake.
- **`createAuth` sets `advanced.disableOriginCheck: false` explicitly.** That is already
  production's default, so production does not change. The suites now run the check
  production runs: `cli.test.ts` failed on the `fetch` sign-in once it did, and passes on the
  fix.

A second finding, the same shape: `Bun.build` inlines `process.env.NODE_ENV`, and inlined it
as `"development"`. The shipped CLI therefore believed it was always in development, and
oclif printed its development warnings into the stderr agent mode promises is empty. The build
now defines it as `"production"`.

## Options rejected

- **In-process `appRouter.createCaller` with a DSN.** This is the backdoor. It skips
  authentication entirely and makes every laptop that runs the CLI a standing superuser.
- **A service token.** It would be a second credential with no person behind it, one that
  cannot be tied to the invitation model and cannot be revoked by signing out.
- **Device flow or a bearer token.** A new auth surface for a problem the email code already
  solves, and one more thing Better Auth's configuration would have to keep right.
- **Publishing to an npm registry.** It would be a second place a version could be published
  from, with its own credential, out of step with the tag that deploys the matching server.
- **An MCP server.** It would be another long-running process, holding a session, for clients
  that can already run a command. The CLI plus a skill works with any agent that has a shell.
- **A read-only scope.** This was the first plan. The request is the UI's whole feature list,
  and the safety is in the per-profile opt-in, not in leaving the writes out.

## Consequences

- A procedure added to the router is a command the next time the CLI is built. If it is a
  mutation, the build refuses it until `procedures.ts` says what it does.
- The CLI can never do more than the person could do in the browser.
- The tarball is first published by the first release after this change. Until then, run
  the CLI with `task dev:cli`.

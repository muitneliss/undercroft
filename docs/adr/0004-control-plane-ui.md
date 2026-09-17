# ADR 0004 — A control plane UI, and why it is not the thing ADR 0003 rejected

- **Status:** Accepted
- **Date:** 2026-09-17
- **Deciders:** Cuong Tran (owner), implementing agent
- **Relates to:** [ADR 0003](0003-ingestion-without-airbyte.md), [ADR 0002](0002-source-mock-mode.md)

## Context

The platform can ingest four sources, land them immutably, curate them and serve
them to Metabase. It has no way for anyone to **connect an account**.

That gap was worse than "not built yet". Exploration found the live-credential
path was broken end to end:

- `vcdo/core/config.py` *required* `VCDO_<SOURCE>_CREDENTIALS` for every live
  source, while `Config` had no field to hold the value and nothing ever read it
  again.
- `vcdo/cli/pipeline.py` constructed all four sources passing **no credential**,
  with three hardcoded fixture constants.
- So `VCDO_XERO_MODE=live` passed validation and then crashed in
  `XeroSource.__init__`. No gate test imported `vcdo.cli.pipeline`, so
  `make verify` was green over all of it.
- There was no OAuth anywhere. `google-auth-oauthlib` was a declared dependency
  that was never imported.

ADR 0002 deferred this deliberately — "a HubSpot private app, a Xero connection
slot, and a Google Workspace OAuth decision that needs an administrator" — on the
assumption that going live would be "an environment change and a credential".
That assumption does not survive contact with more than one customer: one
environment variable per source cannot name a second tenant, and OAuth tokens
rotate, which an environment variable cannot do at runtime.

## The objection this ADR has to answer

ADR 0003 rejected Airbyte and said, in terms:

> No Kubernetes, no second plugin system, **no additional UI to secure and back
> up**.

Adding a web UI three weeks later needs more than "but this one is ours".

**What 0003 rejected was an ingestion platform**: a second system that runs
connectors, holds its own scheduler and state, ships a plugin ecosystem, and
whose UI is the way you operate *it*. The cost was that it duplicates every
capability this stack already has, and that its failure modes are its own rather
than ours.

**What this adds is a configuration surface over the worker that already
exists.** Concretely:

| | Airbyte (rejected) | This |
|---|---|---|
| Runs connectors | Yes, its own runtime | No — asks the worker, over the existing verb allowlist |
| Scheduler | Its own | None. Kestra keeps scheduling |
| Plugin system | Yes | No |
| Own datastore | Yes, must be backed up separately | No. Two tables in the Postgres already backed up |
| Containers added | `abctl` + a `kind` Kubernetes cluster | One |
| Failure mode if it is down | Ingestion stops | Ingestion continues on schedule; nobody can change settings |

That last row is the test. **The platform keeps working with this service
stopped.** Kestra still fires, the worker still syncs, Metabase still serves. It
is not in the data path; it is in the configuration path.

## Decision

Add one container, `api`, running FastAPI, serving `/api/*` and a built
Vite/React/TypeScript SPA.

- **Beside the worker, not inside it.** The worker's trigger server is a fixed
  five-verb allowlist behind a shared secret, bound to the container's own
  interface and never published; its own docstring argues it is "deliberately not
  a web framework". Growing it into one would publish the process that holds the
  pipeline lock, and make a multi-minute sync share a process with browser
  requests.
- **It triggers runs by calling that same allowlist**, with the same token Kestra
  presents. It gets no wider privilege than the scheduler has.
- **Synchronous triggering stays the default.** Every flow in `flows/` asserts
  `outputs.run_slice.code != 200`. Switching the endpoint to a 202-with-handle
  would not just fail those assertions — it would silently demote them from "the
  run succeeded" to "the run started", ending nightly failure detection while
  every execution still went green. The control plane opts into a handle with
  `{"async": true}` because a browser cannot hold a connection open for minutes.

## Cost, measured

**Memory: +512 MiB.** The stack's declared limits go from 8.12 GiB to 8.62 GiB,
against 11 GiB free and **no swap** (ADR 0001 §3). Overcommit is an abrupt OOM
kill on this host, so the limit is mandatory and CI enforces it.

**A second public surface.** Metabase was the only service with a domain. This is
the second, and unlike Metabase it accepts a session cookie and holds the master
key that opens every stored OAuth credential. Consequences, all load-bearing:

- It runs as its own non-root user in its own image, carrying no
  `postgresql-client` and no fixtures.
- Having a domain attaches it to the shared `dokploy-network`, where a bare
  `postgres` once resolved to **another project's database**. Every internal
  reference uses the `vcdo-` prefixed aliases.
- Sessions are server-side so that signing out revokes rather than forgets.
- A non-member gets 404, never 403, so the endpoint cannot be used to enumerate
  the customer list.

**The gate now needs Bun.** `make verify` previously ran with Python alone. It
now also runs ESLint and Vitest over `ui/`. This is deliberate: a separately
invoked frontend check is how two definitions of "green" drift apart. The `ui-*`
targets fail loudly with an install hint rather than skipping, because a check
that passes because its toolchain is missing is worse than no check at all.

## Options rejected

**Extend the worker's trigger server.** Avoids a container. Publishes the
unpublished process, contradicts that module's stated design, and puts a public
web server in the same process as the pipeline lock.

**Configure through environment variables and redeploy.** What exists today. It
cannot describe two customers, cannot rotate a token at runtime, and makes
onboarding a deploy — which means it is done by an engineer, not by the person
who has the customer on the phone.

**A static SPA with no backend.** OAuth needs a server-side client secret and a
place to put the returned refresh token. It would push both back to the CLI.

## Risk this decision does not remove

`gmail.readonly` and `drive.readonly` are Google **restricted** scopes. Serving
them to non-Workspace (personal) accounts requires Google verification *plus* an
annual third-party CASA security assessment — thousands of dollars, weeks of
calendar time, recertified every 12 months.

This blocks going live with personal Gmail accounts. It does not block the build,
and three mitigations exist:

1. Keep the OAuth app in Testing during development (≤100 test users). **Note
   that refresh tokens expire after 7 days in that status**, which presents as
   random revocation and will waste a day if unexpected.
2. Use `drive.file` + the Google Picker for Drive. It is **not** restricted, and
   removes half the exposure. `DRIVE_SCOPES_NARROW` exists for this.
3. For client organisations on Google Workspace, admin-installed domain-wide
   delegation avoids per-user consent entirely.

Gmail message reading has no non-restricted alternative. **Start the verification
paperwork in parallel with the build, not after it.**

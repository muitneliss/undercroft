---
title: Runbook Deployment
type: source
date: 2026-09-18
tags: []
source: docs/runbook/deployment.md
source_path: docs/runbook/deployment.md
source_hash: 005f32b738095fe8e57f1e1970ab765ceb162025b870fab8b4b27e8d21ee900e
ingested: 2026-09-18
---

# Runbook Deployment

Undercroft runs on the Dokploy instance at `lowbit.link` as a single raw-compose stack.
The reasoning behind this arrangement is [[ADR 0008 Deploy on Release from CI]].

## Live surfaces

Only two services are public: the control plane and Metabase. Everything else — `worker`,
`minio`, `postgres`, `kestra` and its database, and Metabase's own database — talks over the
compose network and publishes nothing.

> **Sign-in must be configured, or the control plane has no way in.** Authentication is
> assembled only when its environment is complete. With any of `UNDERCROFT_PUBLIC_URL`,
> `UNDERCROFT_SESSION_SECRET` or the email settings unset, the process starts with **no
> `/api/auth/*` route at all** and every `/trpc/*` call is anonymous. Check for
> `sign_in_unconfigured` in the boot log.

## The two compose files

`deploy/compose/docker-compose.yml` is for development (it builds images and binds ports to
localhost). `docker-compose.server.yml` is what Dokploy holds a copy of. It differs in four
ways, **each a failure that happened once**:

1. **Published images** — Dokploy raw compose has no checkout, so `build:` has no context.
2. **No host ports** — only the two public surfaces are reachable, through Dokploy's proxy.
3. **A unique network alias per service** (`undercroft-postgres`, `undercroft-minio`, …).
   A service with a domain is attached to the shared `dokploy-network`, where `postgres` and
   `minio` are names other projects use too — on the old stack Metabase authenticated
   against another project's database, stopped only by a password mismatch.
4. **Metabase has its own database** — sharing the platform's would put BI's tables inside
   the schema [[ADR 0005 The Role and Grant Model]] governs.

Keep the two files in step: a change to the development file that is not mirrored to the
server file will not survive a deploy.

## How a deploy happens

**Automatically, on a release.** Merge the release-please PR → version bumps, a tag is cut →
images build → `scripts/dokploy.ts` runs `preflight → deploy → verify → smoke`. A plain push
to `main` ships nothing.

**By hand**, using the same client with `DOKPLOY_API_ENDPOINT`, `DOKPLOY_API_KEY` and
`DOKPLOY_COMPOSE_ID` exported (never written to a file), running the same four subcommands.

The API is the only channel for a change. SSH is for reading state, never making one: a
direct edit on the host is drift the next deploy silently reverts.

### What `verify` proves

It asks the host for the config digest each released container is actually running and
compares it to what ghcr serves — because Dokploy reports `done` for a deploy that changed
nothing, and every smoke probe passes against the old images.

Passing an explicit tag makes the other side of the comparison that release's immutable
manifest, so a pass means "the host runs this release" rather than "a moving pointer equals
itself".

`verify` reads which services are long-running and which are one-shot from the compose
file's own `condition: service_completed_successfully` declarations rather than a list it
keeps. A long-running service must be `running`; a one-shot job (`db-migrate`) must have
**exited 0**. Both still have their digest checked — a migration that exited 0 on last
release's image is still the wrong thing having run.

## Environment variables

**Dokploy does not inject its variables into containers.** A variable saved in Dokploy is
only the *source* of a value; it reaches a container only if that service's `environment:`
block names it. An unmapped one arrives as an empty string and fails far from the cause.

Production values live in Dokploy's environment and in a local gitignored file, never
committed. The `:?set in .env` variables have no default and hard-fail the stack if unset.

**CI never writes the panel's configuration** — not the compose file, not the environment
blob. `saveEnvironment` replaces the whole blob, which holds every live credential, so
`preflight` asserts the config and a human repairs a drift. `scripts/dokploy.ts` has no
write-environment subcommand for this reason.

## Applying migrations

**A deploy applies them.** The `db-migrate` service runs `bun run migrate` from the
control-plane image, and both the control plane and the worker wait on
`service_completed_successfully` — so no service ever starts against a schema lacking its
tables. It is idempotent and ledgered.

It is a one-shot service rather than a call at service boot on purpose: two replicas racing
the same DDL is a failure that only appears under the load you least want it to.

It prints what it applied and what it skipped — "already up to date" and "applied 1
migration(s)" are different facts, and a log that cannot tell them apart is no evidence.

**If the schema is behind, sign-in does not degrade — it stops.** See
[[ADR 0010 Invite-Only Sign-In with Better Auth]].

## Sign-in

Invite-only, by Google or a one-time code. [[Runbook Sign-In Setup]] is the step-by-step
walkthrough; this page carries the production-specific part.

The Google client is a Web application OAuth client with one authorized redirect URI per
origin anyone signs in from. The path is Better Auth's and is not configurable without
changing `basePath`. The origin must match `UNDERCROFT_PUBLIC_URL` exactly.

**Scopes stay at `openid email profile`. Do not add Gmail or Drive scopes here.** Ingestion
credentials are a separate per-tenant consent held sealed in `app.connection_secret`.

### Bootstrapping the first admin

Invitations are issued from the **People** division once someone is in. Nobody is, on a
fresh deployment, and there is no one to invite them.

**Set `UNDERCROFT_SUPERADMINS` in Dokploy's environment and redeploy.** It is a
comma-separated list of addresses that may sign in with no invitation and that administer
every customer. Name more than one — a single address is a single point of lockout.

Those addresses then sign in, create the first customer from the **Add a customer** form on
the Customers page (visible only to them), and invite everyone else from People. No shell
and no SQL. The variable is the authority rather than a seed: removing an address and
redeploying withdraws it at the next request, which is also how to recover if every tenant
admin leaves. The boot log reports `superadmins_configured` with a count, never the
addresses. See [[ADR 0013 Superadmins Named in the Environment]].

The older path still works and is the one for an ordinary invitation to a single customer:
`bun run invite`, run inside the control-plane container which already has the DSN.
`--create-tenant` is opt-in, so a mistyped tenant id cannot invent a customer. It writes an
ordinary invitation and grants nothing on its own.

Then sign in with **exactly** that address: the first sign-in creates the `app.app_user`
row, redeems every live invitation into `app.tenant_member`, and stamps `accepted_at`.

## Rollback

Set `IMAGE_TAG=vX.Y.Z` (a previously published tag) in Dokploy's environment and redeploy.
The curated layer is a projection rebuilt from the raw lake
([[ADR 0001 Raw Lake Is the Only Durable Layer]]), so a rollback needs no database restore
unless the schema changed.

**Put `IMAGE_TAG` back to `latest` once the fix ships.** While pinned, the next release's
deploy will fail `verify` — that is the drift being reported, not a bug in the check.

## Administering Kestra

Kestra has no domain by design. To load or inspect flows, tunnel to it over read-only SSH.
Two behaviours that waste time otherwise:

* `{{ envs.x }}` resolves from **`ENV_X`**, not `KESTRA_X`. The prefix changed in 0.23
  deliberately: a `KESTRA_*` variable can override Micronaut config.
* Kestra **silently rejects a password failing its complexity rules** — it 401s every
  request, including with the exact credentials configured. Use upper + lower + digit.

## Known gaps

* **Nobody needs SQL, and nobody needs a shell.** The first admins come from
  `UNDERCROFT_SUPERADMINS` in Dokploy's environment; everyone after that is invited from the
  People division.
* **The real `pg` + `search_path` path is exercised on deploy, not in the gate.**
* The `undercroft_dbt` role that `dbt/profiles.yml` connects as is not created by any
  migration on this branch; the transform verb will fail until it exists.
* **The raw lake is not in a backup set** — it is object storage with its own durability
  story, and the one layer that cannot be regenerated. Versioning and replication, not a
  nightly dump. Recorded rather than quietly omitted.

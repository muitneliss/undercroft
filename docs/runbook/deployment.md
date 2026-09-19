# Deployment runbook

Undercroft runs on the Dokploy instance at `lowbit.link` as a single raw-compose stack.

**Live surface:**

- https://undercroft.lowbit.link — the control plane (`control-plane`). The Reports
  division inside it is the BI; Metabase is gone (ADR 0020).

Everything else talks over the compose network and publishes nothing.

## What is deployed

| Service                      | Reachable from       | Notes                                                                  |
| ---------------------------- | -------------------- | ---------------------------------------------------------------------- |
| `control-plane`              | the internet, HTTPS  | tRPC + sign-in + SPA. **Configure sign-in — see the warning below.**   |
| `worker`                     | compose network only | Ingestion, dbt per tenant, the BI query runner; HTTP verbs on :8081    |
| `minio`                      | compose network only | Raw lake                                                               |
| `postgres`                   | compose network only | Curated + control-plane schema                                         |
| `kestra` + `kestra-postgres` | compose network only | Scheduling: `ingest_due` every 15 minutes                              |
| `db-migrate`                 | one-shot, exits 0    | Applies `packages/db/sql`, sets the two platform roles' passwords      |
| `kestra-flows`               | one-shot, exits 0    | Delivers `flows/` to Kestra from the control-plane image, every deploy |

> **Sign-in must be configured, or the control plane has no way in.** Authentication is
> wired (invite-only, Google or an emailed code — ADR 0010), but it is assembled only when
> its environment is complete. With any of `UNDERCROFT_PUBLIC_URL`,
> `UNDERCROFT_SESSION_SECRET` or the email settings unset, the process starts with no
> `/api/auth/*` route at all and every `/trpc/*` call is anonymous — which is the state ADR
> 0008's risk note described. Check for `sign_in_unconfigured` in the boot log, and see
> [Sign-in](#sign-in) below.

## The two compose files

`deploy/compose/docker-compose.yml` is for development (it `build:`s the images and binds
ports to localhost). `docker-compose.server.yml` is what Dokploy holds a copy of. It differs
in three ways, each a failure that happened once:

1. **Published images**, `ghcr.io/muitneliss/undercroft-{worker,control-plane}:${IMAGE_TAG:-latest}`.
   Dokploy raw compose has no checkout, so `build:` has no context there.
2. **No host ports.** Only the control plane is reachable, through Dokploy's proxy.
3. **A unique network alias per service** (`undercroft-postgres`, `undercroft-minio`, …), and
   every reference uses it. A service with a domain is attached to the shared
   `dokploy-network`, where `postgres` and `minio` are names other projects use too — on the
   old stack, the Metabase it then carried authenticated against another project's database,
   stopped only by a password mismatch.

Keep the two files in step. A change to the development file that is not mirrored to the
server file will not survive a deploy.

## How a deploy happens

**Automatically, on a release.** Merge the release-please PR → `version` bumps, a tag is cut
→ the images build → `scripts/dokploy.ts` runs `preflight → deploy → verify → smoke`. See
ADR 0008. Nothing else deploys; a plain push to `main` ships nothing.

**By hand**, using the same client (needs the three env vars — never write them to a file):

```bash
export DOKPLOY_API_ENDPOINT=https://lowbit.link/api
export DOKPLOY_API_KEY=...           # from Dokploy → Settings → API
export DOKPLOY_COMPOSE_ID=...        # the undercroft compose

bun run scripts/dokploy.ts preflight   # panel points at published images and pulls them
bun run scripts/dokploy.ts deploy      # trigger, then wait for the record THIS run created
bun run scripts/dokploy.ts verify v1.2.3  # every released container runs that tag's digest
bun run scripts/dokploy.ts smoke https://undercroft.lowbit.link/api/health
```

The API is the only channel for a change. SSH is for reading state, never making one: a
direct edit on the host is drift the next deploy silently reverts.

### What `verify` proves

It asks the host for the config digest each released container is actually running, and
compares it to what ghcr serves — because Dokploy reports `done` for a deploy that changed
nothing, and every smoke probe passes against the old images.

The tag argument is which ghcr manifest to compare against. The **host** pulls `latest` (the
panel's `IMAGE_TAG`); passing `v1.2.3` makes the other side of the comparison that release's
immutable manifest, so a pass means "the host runs this release" rather than "a moving
pointer equals itself". A release publishes both tags to one digest, so they agree unless
something is wrong. Omit the tag and it falls back to `latest`, which is the honest question
when there is no release being rolled out.

Two services need different questions, and `verify` reads which is which from the compose
file's own `condition: service_completed_successfully` declarations rather than from a list
it keeps: a long-running service must be `running`, while a one-shot job (`db-migrate`,
`kestra-flows`) must have **exited 0**. Both still have their digest checked — a migration
that exited 0 on last release's image is still the wrong thing having run.

## Environment variables

**Dokploy does not inject its variables into containers.** A variable saved in Dokploy is
only the _source_ of a value; it reaches a container only if that service's `environment:`
block names it. An unmapped one arrives as an empty string and fails far from the cause.

Production values live in Dokploy's environment and in a local gitignored file; they are
never committed. `deploy/compose/.env.example` lists the names. The `:?set in .env` variables
have no default and hard-fail the stack if unset:
`UNDERCROFT_S3_ACCESS_KEY`, `UNDERCROFT_S3_SECRET_KEY`, `UNDERCROFT_PG_PASSWORD`,
`UNDERCROFT_APP_PG_PASSWORD`, `UNDERCROFT_WORKER_PG_PASSWORD`, `UNDERCROFT_KESTRA_PASSWORD`,
`UNDERCROFT_KESTRA_PG_PASSWORD`, `UNDERCROFT_TRIGGER_TOKEN`, `UNDERCROFT_SECRET_KEY`,
`UNDERCROFT_SESSION_SECRET`, `UNDERCROFT_PUBLIC_URL`.

The per-source clients default to empty and are set when the source is offered:
`UNDERCROFT_GOOGLE_INGEST_CLIENT_ID/SECRET` (Gmail, Drive) and
`UNDERCROFT_XERO_CLIENT_ID/SECRET` (Xero, see [xero-setup.md](./xero-setup.md)). A source whose
client is unset cannot be connected, and the card says so; HubSpot needs no client, because
its token is pasted. Neither dbt nor BI has a password of its own any more: each build and
each question runs as the tenant's own login, whose password the worker mints right before
(ADR 0018). `UNDERCROFT_DBT_PASSWORD` and `UNDERCROFT_METABASE_PG_PASSWORD` are dead, and
removing them from Dokploy's environment — with the `undercroft-bi.lowbit.link` domain — is a
human's step in rolling this release out, because CI never writes the blob.

**Each service connects as its own role.** `db-migrate` is the one service that connects as
the bootstrap superuser: it applies the schema and then sets `undercroft_app`'s and
`undercroft_worker`'s passwords from `UNDERCROFT_APP_PG_PASSWORD` and
`UNDERCROFT_WORKER_PG_PASSWORD`. The control plane and the worker connect as those roles, so
the grant model in `packages/db/sql` is what binds them — and a repo statement missing a grant
fails in the offline gate, where every suite runs as the role that runs it in production
(`db.become(...)` in `@undercroft/db/testing`). Adding the two variables to Dokploy's
environment is part of rolling this release out; without them `db-migrate` refuses to start.

## Applying migrations

**A deploy applies them.** The `db-migrate` service runs `bun run migrate` from the
control-plane image, and both the control plane and the worker wait on
`service_completed_successfully` — so no service ever starts against a schema that lacks its
tables. It is idempotent and ledgered, so re-running each deploy costs one query.

It is a one-shot service rather than a call at service boot on purpose: the control plane may
one day run more than one replica, and two replicas racing the same DDL is a failure that
only appears under the load you least want it to.

To apply by hand — a database restored from backup, or a migration you want in before a
deploy:

```sh
UNDERCROFT_POSTGRES_DSN=... bun run migrate
```

It prints what it applied and what it skipped: "already up to date" and "applied 1
migration(s)" are different facts, and a log that cannot tell them apart is no evidence.

**If the schema is behind, sign-in does not degrade — it stops.** Better Auth raises
`SchemaMismatchError` and answers 500 to every `/api/auth/*` request, while still logging
`sign_in_configured` at boot. Look for `Database schema mismatch` with the missing table
names in the control-plane log.

## Sign-in

Invite-only, by Google or by a one-time code emailed to the address. See ADR 0010 for the
reasoning, and **[sign-in-setup.md](./sign-in-setup.md) for a step-by-step walkthrough** of
standing it up from nothing, including local development. What follows is the
production-specific part.

**Google client** — Cloud Console → APIs & Services → Credentials → OAuth client ID, type
_Web application_. Authorized redirect URIs, one per origin anyone signs in from:

| Origin          | Redirect URI                                      |
| --------------- | ------------------------------------------------- |
| production      | `https://<domain>/api/auth/callback/google`       |
| compose, local  | `http://localhost:13000/api/auth/callback/google` |
| Vite dev server | `http://localhost:5173/api/auth/callback/google`  |

The path is Better Auth's and is not configurable without changing `basePath`. The origin
must match `UNDERCROFT_PUBLIC_URL` exactly, because that is what the `redirect_uri` is built
from — a mismatch is Google's `redirect_uri_mismatch`, not a platform error.

Scopes stay at `openid email profile`. **Do not add Gmail or Drive scopes here.** Ingestion
credentials are a separate per-tenant consent held sealed in `app.connection_secret`; asking
for a mailbox as a side effect of signing in is the thing that arrangement exists to prevent.

**If sign-in is unconfigured** the control plane starts with no way in and logs
`sign_in_unconfigured` once, naming which of `UNDERCROFT_PUBLIC_URL`,
`UNDERCROFT_SESSION_SECRET`, the email settings and the Google pair are missing. Check that
line first; a button that fails at the first click is the failure this avoids.

### Bootstrapping the first admin

Invitations are issued from the **People** division once someone is in. Nobody is, on a fresh
deployment, and there is no one to invite them.

**Set `UNDERCROFT_SUPERADMINS` in Dokploy's environment and redeploy.** It is a
comma-separated list of addresses that may sign in with no invitation and that administer
every customer:

```
UNDERCROFT_SUPERADMINS=you@example.test,colleague@example.test
```

Name more than one. A single address here is a single point of lockout.

Those addresses can then sign in, create `CASE-0001` from the **Add a customer** form on the
Customers page — visible only to them — and invite everyone else from **People**. No shell,
no SQL, and the variable is the authority rather than a seed: removing an address and
redeploying withdraws it at the next request, which is also how you recover if every tenant
admin leaves. The boot log reports `superadmins_configured` with a count, never the
addresses. ADR 0013.

The older path still works and is the one to use for an ordinary invitation to a single
customer, run in the control-plane container, which already has the DSN:

```sh
docker exec -it undercroft-<stack>-control-plane-1 bun run invite -- \
  you@example.test --tenant CASE-0001 --role admin --create-tenant
```

`--create-tenant` is opt-in, so a mistyped tenant id cannot invent a customer. It writes an
ordinary invitation and grants nothing on its own; it also emails the invitee, using the
same wording the People page does, when the mail variables are set.

Then sign in with **exactly** that address. The first sign-in creates the `app.app_user`
row, redeems every live invitation for the address into `app.tenant_member`, and stamps
`accepted_at`. Signing in with a different address on the same Google account is refused,
not silently accepted — the invitation is keyed by the address.

From then on, use **People** inside the tenant: invite an address, pick a role, withdraw an
invitation that has not been accepted. An admin can invite; a member and a viewer cannot, and
the server refuses regardless of what the browser shows. The page reports whether the
invitation was actually emailed — with no mail configured it still works, and you have to
tell the person yourself.

## Rollback

**Which release is on screen is printed at the foot of every page of the control plane**, and
on the sign-in page too, so it can be read by someone who cannot get in. That stamp is the
tag the bundle was built from — paste it into `IMAGE_TAG` verbatim to come back to it.

Set `IMAGE_TAG=vX.Y.Z` (a previously published tag) in Dokploy's environment and redeploy.
The curated layer is a projection rebuilt from the raw lake, so a rollback needs no database
restore unless the schema changed.

**Put `IMAGE_TAG` back to `latest` once the fix ships.** While it is pinned, the host keeps
serving the pinned release, so the next release's deploy will fail `verify` — the running
digest is not the one ghcr serves for the tag being rolled out. That is the drift being
reported, not a bug in the check: the release genuinely did not reach the host.

## Administering Kestra

**The flows are delivered by the deploy.** `flows/` is baked into the control-plane image,
and the `kestra-flows` one-shot service runs `scripts/kestraFlows.ts` against Kestra's API
on every deploy — `PUT` per flow, `POST` when it is new — and exits non-zero on a flow Kestra
rejects, so the worker (which waits on it) never starts against a scheduler holding last
release's flow. There is nothing to upload by hand; a flow that is only on the server is
drift the next deploy reverts. The one flow, `ingest_due`, asks the worker every fifteen
minutes which (customer, source) pairs are due and starts each; a pair already running is a
409 the flow ignores.

Kestra has no domain by design — it is an operator surface holding execution history. To
inspect executions, tunnel to it over read-only SSH; a tunnel carries application data,
which is not a Dokploy configuration change and so is not the thing the API-only rule is
about.

Two Kestra behaviours that waste time otherwise:

- `{{ envs.x }}` resolves from **`ENV_X`**, not `KESTRA_X`. The prefix changed in 0.23
  deliberately: a `KESTRA_*` variable can override Micronaut config and become readable from
  every flow.
- Kestra **silently rejects a password that fails its complexity rules** — it 401s every
  request, including with the exact credentials configured. Use upper + lower + digit.

## Known gaps

- **Nobody needs SQL, and since ADR 0013 nobody needs a shell either.** The first admins come
  from `UNDERCROFT_SUPERADMINS` in Dokploy's environment (see [Sign-in](#sign-in)); everyone
  after that is invited from the People division.
- **The real `pg` + `search_path` path is exercised on deploy, not in the gate.** Better Auth
  emits unqualified table names against a pool whose `search_path` is `app`; the offline gate
  uses its memory adapter. A mistake here fails loudly (`Database schema mismatch`)
  rather than silently, and `bun run migrate` is what prevents it.
- **A real login is proven in the Docker tier, not the gate.** PGlite has no authentication,
  so the offline suites stand in a `SET ROLE` for a login. `bun run itest` opens a connection
  _as_ a tenant's role against the compose Postgres (start it with
  `docker compose -f deploy/compose/docker-compose.yml up -d postgres`, with
  `deploy/compose/.env` filled in) and proves it sees only its tenant and that `RESET ROLE`
  gives it nothing more. Run it after any change to `packages/db/sql`.
- The raw lake is not in a backup set — it is object storage with its own durability story,
  and the one layer that cannot be regenerated. Versioning and replication, not a nightly
  dump. Recorded rather than quietly omitted.

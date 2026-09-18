# Deployment runbook

Undercroft runs on the Dokploy instance at `lowbit.link` as a single raw-compose stack.

**Live surfaces:**

- https://undercroft.lowbit.link — the control plane (`control-plane`).
- https://undercroft-bi.lowbit.link — Metabase.

Everything else talks over the compose network and publishes nothing.

## What is deployed

| Service                      | Reachable from       | Notes                                                                |
| ---------------------------- | -------------------- | -------------------------------------------------------------------- |
| `control-plane`              | the internet, HTTPS  | tRPC + sign-in + SPA. **Configure sign-in — see the warning below.** |
| `metabase`                   | the internet, HTTPS  | Dashboards. Has its own `metabase-postgres`.                         |
| `worker`                     | compose network only | Ingestion + dbt subprocess; HTTP trigger on :8081                    |
| `minio`                      | compose network only | Raw lake                                                             |
| `postgres`                   | compose network only | Curated + control-plane schema                                       |
| `kestra` + `kestra-postgres` | compose network only | Scheduling                                                           |
| `metabase-postgres`          | compose network only | Metabase's own content                                               |

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
in four ways, each a failure that happened once:

1. **Published images**, `ghcr.io/muitneliss/undercroft-{worker,control-plane}:${IMAGE_TAG:-latest}`.
   Dokploy raw compose has no checkout, so `build:` has no context there.
2. **No host ports.** Only the two public surfaces are reachable, through Dokploy's proxy.
3. **A unique network alias per service** (`undercroft-postgres`, `undercroft-minio`, …), and
   every reference uses it. A service with a domain is attached to the shared
   `dokploy-network`, where `postgres` and `minio` are names other projects use too — on the
   old stack, Metabase authenticated against another project's database, stopped only by a
   password mismatch.
4. **Metabase has its own database.** In development it shares the platform's; on the server
   that would put BI's tables inside the schema ADR 0005 governs.

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
bun run scripts/dokploy.ts verify      # every released container runs the published digest
bun run scripts/dokploy.ts smoke https://undercroft.lowbit.link/api/health https://undercroft-bi.lowbit.link/api/health
```

The API is the only channel for a change. SSH is for reading state, never making one: a
direct edit on the host is drift the next deploy silently reverts.

## Environment variables

**Dokploy does not inject its variables into containers.** A variable saved in Dokploy is
only the _source_ of a value; it reaches a container only if that service's `environment:`
block names it. An unmapped one arrives as an empty string and fails far from the cause.

Production values live in Dokploy's environment and in a local gitignored file; they are
never committed. `deploy/compose/.env.example` lists the names. The `:?set in .env` variables
have no default and hard-fail the stack if unset:
`UNDERCROFT_S3_ACCESS_KEY`, `UNDERCROFT_S3_SECRET_KEY`, `UNDERCROFT_PG_PASSWORD`,
`UNDERCROFT_KESTRA_PG_PASSWORD`, `UNDERCROFT_TRIGGER_TOKEN`, `UNDERCROFT_SECRET_KEY`,
`UNDERCROFT_SESSION_SECRET`, `UNDERCROFT_DBT_PASSWORD`, `UNDERCROFT_METABASE_PG_PASSWORD`,
`UNDERCROFT_PUBLIC_URL`.

## Applying migrations

The schema is not applied by starting a service. Run it as its own step, before the new
images start:

```sh
UNDERCROFT_POSTGRES_DSN=... bun run migrate
```

It prints what it applied and what it skipped, and is idempotent — "already up to date" and
"applied 1 migration(s)" are different facts, and a deploy log that cannot tell them apart
is no evidence. Deliberately not run at boot: the control plane can run more than one
replica, and two replicas racing the same DDL is a failure that appears under the worst load.

Sign-in needs `060_auth.sql`. Until it is applied, every login fails with
`relation "auth_user" does not exist`.

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
deployment, and there is no one to invite them — so exactly one insert is needed, once:

```sql
INSERT INTO ops.tenant (id, display_name)
VALUES ('CASE-0001', 'First tenant') ON CONFLICT DO NOTHING;

-- The token column is unused by this flow (Google and a one-time code already prove the
-- person controls the address), but it is NOT NULL, so it gets a digest of a random value.
INSERT INTO app.invitation (tenant_id, email, role, token_sha256, expires_at)
VALUES ('CASE-0001', 'you@example.test', 'admin',
        encode(sha256(gen_random_uuid()::text::bytea), 'hex'),
        now() + interval '7 days');
```

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

Set `IMAGE_TAG=vX.Y.Z` (a previously published tag) in Dokploy's environment and redeploy.
The curated layer is a projection rebuilt from the raw lake, so a rollback needs no database
restore unless the schema changed.

## Administering Kestra

Kestra has no domain by design — it is an operator surface holding flow history. To load or
inspect flows, tunnel to it over read-only SSH; a tunnel carries application data (flows,
executions), which is not a Dokploy configuration change and so is not the thing the
API-only rule is about.

Two Kestra behaviours that waste time otherwise:

- `{{ envs.x }}` resolves from **`ENV_X`**, not `KESTRA_X`. The prefix changed in 0.23
  deliberately: a `KESTRA_*` variable can override Micronaut config and become readable from
  every flow.
- Kestra **silently rejects a password that fails its complexity rules** — it 401s every
  request, including with the exact credentials configured. Use upper + lower + digit.

## Known gaps

- **Only the first admin needs SQL.** After that, invitations are issued from the People
  division. The bootstrap insert is under [Sign-in](#sign-in), and it exists because there is
  nobody to invite the first person.
- **The real `pg` + `search_path` path is first exercised on deploy.** Better Auth emits
  unqualified table names against a pool whose `search_path` is `app`; the offline gate uses
  its memory adapter. A mistake here fails loudly (`relation "auth_user" does not exist`)
  rather than silently, and `bun run migrate` is what prevents it.
- The `undercroft_dbt` role that `dbt/profiles.yml` connects as is not created by any
  migration on this branch; the transform verb will fail until it exists.
- The raw lake is not in a backup set — it is object storage with its own durability story,
  and the one layer that cannot be regenerated. Versioning and replication, not a nightly
  dump. Recorded rather than quietly omitted.

# Deployment runbook

Undercroft runs on the Dokploy instance at `lowbit.link` as a single raw-compose stack.

**Live surfaces:**

- https://undercroft.lowbit.link — the control plane (`control-plane`).
- https://undercroft-bi.lowbit.link — Metabase.

Everything else talks over the compose network and publishes nothing.

## What is deployed

| Service                      | Reachable from       | Notes                                                                  |
| ---------------------------- | -------------------- | ---------------------------------------------------------------------- |
| `control-plane`              | the internet, HTTPS  | tRPC + OAuth + SPA. **Auth is not wired yet — see the warning below.** |
| `metabase`                   | the internet, HTTPS  | Dashboards. Has its own `metabase-postgres`.                           |
| `worker`                     | compose network only | Ingestion + dbt subprocess; HTTP trigger on :8081                      |
| `minio`                      | compose network only | Raw lake                                                               |
| `postgres`                   | compose network only | Curated + control-plane schema                                         |
| `kestra` + `kestra-postgres` | compose network only | Scheduling                                                             |
| `metabase-postgres`          | compose network only | Metabase's own content                                                 |

> **The control plane is public with no authentication.** On this branch
> `apps/control-plane` reads no session secret and `/trpc/*` falls back to an anonymous
> context, so anyone who reaches `undercroft.lowbit.link` can call its routers. Do not
> connect a real account until sessions and OAuth land. See ADR 0008's risk note.

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
`UNDERCROFT_SESSION_SECRET`, `UNDERCROFT_DBT_PASSWORD`, `UNDERCROFT_METABASE_PG_PASSWORD`.

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

- **The control plane's auth is not wired** (see the warning above). It is the blocking item
  before any real onboarding.
- The `undercroft_dbt` role that `dbt/profiles.yml` connects as is not created by any
  migration on this branch; the transform verb will fail until it exists.
- The raw lake is not in a backup set — it is object storage with its own durability story,
  and the one layer that cannot be regenerated. Versioning and replication, not a nightly
  dump. Recorded rather than quietly omitted.

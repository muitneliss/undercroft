# Deployment runbook

The platform is deployed on the Dokploy instance at `lowbit.link`, in project
`vietcham-data-ops`, as a single raw-compose service.

**Live:** https://vcdo.lowbit.link — Metabase, and the only public surface.

## What is deployed

| Service | Reachable from | Notes |
|---|---|---|
| `metabase` | the internet, HTTPS | The only service with a domain |
| `minio` | compose network only | Raw lake. Holds customer documents. |
| `postgres` | compose network only | Curated layer |
| `kestra` + `kestra-postgres` | compose network only | Scheduling |
| `metabase-postgres` | compose network only | Metabase's own content |
| `worker` | compose network only | Ingestion; HTTP trigger on :8081 |

**No service other than Metabase publishes a port.** The development compose
binds ports to localhost for convenience; the server variant has none at all.
MinIO, Postgres and Kestra each hold or can reach customer data, and this is a
host shared with eleven other projects.

## The two compose files

`deploy/compose/docker-compose.yml` is for development. `docker-compose.server.yml`
is generated from it and differs in three ways, each of which caused a real
failure before it was fixed:

1. **The worker uses a published image**, `ghcr.io/muitneliss/vcdo-worker:<version>`.
   Dokploy raw compose has no repo checkout, so `build:` cannot work there.
2. **Fixtures come from the image, not a bind mount.** `../../fixtures` resolves
   to an *empty directory* on a server with no repo — it does not error, so the
   failure surfaces later as a `SourceError` far from the cause.
3. **No host ports.**

Keep them in step. A change to the development file that is not reflected in the
server file is a change that will not survive a deploy.

## Deploying a change

The Dokploy API is the only channel. SSH is for reading state.

```bash
# 1. Build and publish the worker (server is amd64)
docker buildx build --platform linux/amd64 -f deploy/Dockerfile \
  -t ghcr.io/muitneliss/vcdo-worker:<version> .
docker push ghcr.io/muitneliss/vcdo-worker:<version>

# 2. Point the server compose at the new tag, then push it to Dokploy
#    (compose.update takes the whole file; compose.redeploy applies it)
curl -s -X POST "https://lowbit.link/api/compose.update"   -H "Content-Type: application/json" -H "x-api-key: <key>" -d @payload.json
curl -s -X POST "https://lowbit.link/api/compose.redeploy" -H "Content-Type: application/json" -H "x-api-key: <key>" -d '{"composeId":"<id>"}'
```

Version the image tag rather than reusing `latest`: "which build is running" has
to have an answer.

### Environment variables

**Dokploy does not inject its variables into containers.** A variable saved in
Dokploy is only the *source* of a value; it reaches a container only if that
service's `environment:` block names it. An unmapped variable arrives as an empty
string and fails somewhere far from the cause — this cost a debugging cycle
during the first deploy.

Production values live in `.dokploy-env.json` locally (gitignored) and in
Dokploy's environment. They are never committed and never pasted into docs.

## Administering Kestra

Kestra has no domain by design. To load or inspect flows, tunnel to it:

```bash
KIP=$(ssh ovhvps_lowbit "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' vcdo-ez7v7g-kestra-1")
ssh -f -N -L 18081:$KIP:8080 ovhvps_lowbit
curl -X POST http://localhost:18081/api/v1/main/flows -u "$USER:$PASS" \
  -H "Content-Type: application/x-yaml" --data-binary @flows/hubspot_daily.yml
```

A tunnel is not a Dokploy configuration change: it carries application data
(flows, executions), which is exactly what the API-only rule is not about.

Two Kestra behaviours that will waste your time otherwise:

- `{{ envs.x }}` resolves from **`ENV_X`**, not `KESTRA_X`. The prefix changed in
  0.23 deliberately — Micronaut lets `KESTRA_*` override configuration, so a
  secret passed that way became readable from every flow.
- Kestra **silently rejects a password failing its complexity rules**. It does
  not log it and does not fail to start; it 401s every request including with the
  exact credentials you configured. Use upper + lower + digit.

## Verifying a deploy

A green container is not acceptance.

```bash
# health, from outside
curl -s https://vcdo.lowbit.link/api/health          # {"status":"ok"}

# the worker's healthcheck is a real S3 round trip and SQL query
ssh ovhvps_lowbit 'docker ps --filter name=vcdo --format "{{.Names}} {{.Status}}"'

# run the pipeline through Kestra, which is the designed path
curl -X POST "http://localhost:18081/api/v1/main/executions/vcdo/hubspot_daily" -u "$USER:$PASS"
```

Then look at the numbers, not the status. `ops.run_ledger` must show
`unaccounted = 0` for every stage; `dq.quarantine` holds anything rejected, with
its payload.

## Capacity

Measured 2026-09-17, after deploy: our stack uses ~1.8 GiB; the host has ~10 GB
available of 23 GB, and **no swap**. Every service declares a memory limit, and
CI fails if one does not — without swap, an unlimited container turns a spike
into an OOM kill that takes something else down with it.

## Rollback

Point the server compose at the previous image tag and redeploy. The curated
layer is a projection and can be rebuilt from the raw lake, so a rollback does
not need a database restore unless the schema changed.

For data recovery see `vcdo/cli/backup.py`: `vcdo backup` dumps the curated
schemas, and the restore path is exercised by
`tests/integration/test_backup_restore.py`, which restores into a separate
database and checks the rows, constraints and primary keys came back.

**The raw lake is not in the backup set.** It is object storage with its own
durability story, far larger than everything else, and the one layer that cannot
be regenerated — it wants versioning and replication, not a nightly dump. This is
an open gap, recorded rather than quietly omitted.

## Known gaps

- Metabase's application database (questions, dashboards, permissions) has no
  backup yet. `provision-bi` recreates the connection and the checked-in
  dashboard, but not anything authored since.
- All four sources run in `mock` mode. No production credential exists yet; per
  ADR 0002 that is the correct state for a source that is not onboarded, not a
  placeholder standing in for something missing.

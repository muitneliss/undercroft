# ADR 0001 — Hosting and the raw-to-curated route

- **Status:** Accepted
- **Date:** 2026-09-17
- **Deciders:** Cuong Tran (owner), implementing agent
- **Supersedes:** —

## Context

We are building a data platform that lands HubSpot, Xero, Gmail and Google Drive into an immutable
object-storage raw lake, materialises curated analytical tables, and serves them through Metabase.
Source reference is the legacy repo `vcc-ostwin-architecture-review`, which solves the same domain
problem on a single Windows/WSL operator machine using local SQLite and CSV.

Two decisions are load-bearing and cheap to get wrong: how raw data becomes curated SQL, and where
the ingestion tooling runs.

## Decision 1 — Raw lake on S3/MinIO, curated tables in Postgres

**Chosen.** Raw stays immutable and content-addressed in object storage. Curated tables are
materialised in Postgres, and Metabase connects directly to Postgres.

Rejected for now: Iceberg tables on object storage queried through Trino. It matches the reference
architecture in the handoff, but it requires a catalog service, a separate load/registration step
(Airbyte's Parquet output is *not* automatically an Iceberg table), compaction jobs, and a Trino
coordinator plus worker with real memory. The handoff explicitly sanctions the lean route when
hardware is limited, and the measured host load below makes that the honest call.

The raw S3 data remains the lake either way, so this is a serving-layer decision, not a lake
decision. Migration to Iceberg/Trino stays open: because every curated table is rebuilt
deterministically from raw, the migration is a backfill, not a data rescue.

## Decision 2 — Airbyte for all four sources, behind a Xero reconciliation gate

**Chosen.** HubSpot, Xero, Drive and Gmail *metadata* all ingest through Airbyte. Two components
stay custom because Airbyte cannot do them at all:

- the **Gmail attachment-bytes worker** (Airbyte does not write attachment bytes as S3 objects), and
- the **Drive delete-reconciliation job** (the Drive source does not replicate deletes).

Airbyte rates its own Xero connector's sync success rate *Low*. Rather than replacing it, the legacy
repo's measured Xero corrections move from the ingest path to a **verification gate that blocks
curated publish** on any count/total mismatch, invoice arithmetic failure, or unresolvable payment
parent. See `docs/contracts/ingestion.md`.

## Decision 3 — Airbyte self-hosted on the Dokploy server, deployed in stages

**Chosen.** The host has room, but not a comfortable amount of it, so the deployment is staged and
measured rather than done in one shot.

Host measured 2026-09-17 over read-only SSH (`ovhvps_lowbit`, Debian 13, kernel 6.12):

| Resource | Total | Used | Available |
|---|---|---|---|
| vCPU | 8 (Intel Haswell, 1 thread/core) | load avg 0.60 / 0.50 / 0.42 | effectively idle |
| RAM | 22 GiB | 11 GiB | **11 GiB** |
| Swap | **0 B** | — | none |
| Disk `/` | 197 GB | 37 GB (20%) | **152 GB** |

Uptime 70 days. CPU is a non-issue: load average 0.60 across 8 cores means the existing 26 containers
are nearly idle, and ingestion is I/O-bound anyway.

RAM is the binding constraint. Airbyte via `abctl` brings its own Kubernetes and wants roughly
4–8 GiB; MinIO, Postgres, Kestra and Metabase together want roughly 3–4 GiB. Against 11 GiB
available that fits, with a margin somewhere between comfortable and nearly zero depending on where
Airbyte actually lands. **There is no swap**, so exceeding memory is an abrupt OOM kill rather than a
slowdown — and an OOM kill mid-sync is precisely the failure that produces a silently partial
curated publish.

Therefore:

1. Deploy MinIO, Postgres, Kestra and Metabase first. Measure resident memory.
2. Install Airbyte only after that measurement, and measure again under a real sync.
3. Set **explicit memory limits on every service** — required by the handoff anyway, and here it is
   what converts "the host fell over" into "one container was restarted".
4. Add a swap file as insurance before Airbyte goes on. It should never be used in steady state; it
   exists so that a spike degrades instead of killing.
5. If the post-Airbyte measurement leaves less than ~2 GiB headroom, fall back to option 4 below
   rather than running the platform on the edge.

Disk is not a concern at 152 GB free, but the raw lake grows monotonically — MinIO bucket sizes go on
the monitoring list from day one, and lifecycle policy is decided with the retention policy.

### Options considered

Evidence measured against the target Dokploy instance on 2026-09-17 via the `dokploy` skill
(read-only API calls; no mutations):

| Measurement | Value | Endpoint |
|---|---|---|
| Dokploy projects | 11 | `project.all` |
| Remote servers registered | **0** — everything runs on the Dokploy host itself | `server.all` |
| Containers | 29 (26 running) | `docker.getContainers` |
| Docker images | 34, 16.86 GB (1.40 GB reclaimable) | `settings.getDockerDiskUsage` |
| Local volumes | 28, 4.27 GB | `settings.getDockerDiskUsage` |
| Host CPU / RAM / free disk | **unknown** — see below | — |

The host already runs, among other things: **five Postgres instances** (16, 17, 17-alpine, 18.4), a
**MinIO** instance, Redis, NATS, Jaeger, an OpenTelemetry collector, and a Grafana LGTM stack.

Host CPU/RAM is not readable through the Dokploy API: `server.getServerMetrics` requires a monitoring
agent URL and token, and `metricsConfig` on the account is `null`, so monitoring has never been set
up. Enabling it (`server.setupMonitoring`) is a mutation that deploys a container onto a shared
production host, so it was not run. Capacity was measured over read-only SSH instead, per the skill's
rule that SSH is for reading state.

1. **Self-host Airbyte via `abctl` on this server** — *chosen*, staged as above. No recurring cost.
2. **Separate host for Airbyte** — clean separation, additional server cost. Held in reserve if the
   staged measurement in step 2 above comes back tight.
3. **Airbyte Cloud** — no local footprint, but recurring cost and customer data leaves the estate,
   which needs a PDPA decision given Gmail bodies and accounting data are in scope. Not pursued while
   a self-hosted option fits.
4. **Contingency:** drop Airbyte and run four Python connectors under Kestra. The legacy repo already
   has working pullers for all four sources, so this is a fallback with known cost rather than a
   rewrite. This is the documented exit if headroom after Airbyte falls below ~2 GiB.

## Decision 4 — Dokploy deployment uses raw compose

**Chosen.** `compose.create` accepts `composeType`, `composeFile` and `sourceType`, so compose YAML
can live in Dokploy directly. This avoids needing a git remote, which matters because the legacy repo
is deliberately remote-less for PDPA reasons and this repo has no remote either.

The compose files remain the source of truth in **this** repository under `deploy/compose/`, are
validated with `docker compose config` in CI, and are pushed to Dokploy through the API. Dokploy
holds a copy; the repo holds the history.

Airbyte is **not** deployed through Dokploy in any scenario — `abctl`/Kubernetes sits outside
Dokploy's application/Compose model. It must never be reported as Dokploy-deployed.

## Consequences

- Metabase queries Postgres, so dashboard latency is a Postgres tuning problem, not a distributed
  query problem. Curated tables must stay small enough for that to hold; if they don't, that is the
  trigger to revisit Decision 1.
- Every curated table must be reproducible from raw alone. This is what keeps the Iceberg migration
  and any full rebuild cheap, and it is enforced by test, not by convention.
- The Xero gate is the single point where connector unreliability is caught. It must be tested
  failing closed, because a gate never observed to block is not known to work.
- We are a tenant on a shared host, not its owner. Every service we add carries a memory limit, and
  "it works on an idle host" is not evidence it works — the staged measurement is.
- Memory headroom becomes a standing operational metric, not a one-off check.

## Verification

Discovery evidence is reproducible read-only:

```bash
curl -s "https://lowbit.link/api/settings.getDockerDiskUsage" -H "x-api-key: <key from .dokploy.json>"
curl -s "https://lowbit.link/api/docker.getContainers" -H "x-api-key: <key from .dokploy.json>"
curl -s "https://lowbit.link/api/server.all" -H "x-api-key: <key from .dokploy.json>"
ssh ovhvps_lowbit 'nproc; free -h; df -h /; uptime'
```

The API key lives only in the gitignored `.dokploy.json` and must not be pasted into this document.

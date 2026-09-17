# VietCham Data Platform

HubSpot, Xero, Gmail and Google Drive → an immutable raw lake on S3/MinIO →
curated tables in Postgres → Metabase dashboards, SQL and Metabot.

## Start here

- **[CLAUDE.md](CLAUDE.md)** — working conventions. Read before changing anything.
- **[docs/adr/](docs/adr/)** — decisions, with the options rejected and why.

## Quick start

```bash
make verify   # lint + tests. No credentials, no network, no docker needed.
make up       # the whole platform: minio, postgres, kestra, metabase, worker
make seed     # fixture records into local MinIO
make slice    # full fixture run: raw -> curated -> dashboard query
```

The whole gate runs offline against fixtures. Nothing in `make verify` touches a
real source, a real credential, or a deployed service.

There is no ingestion platform and no Kubernetes: `dlt` is a library inside the
worker container. `make up` is the entire stack.

## Layout

```
vcdo/core/      config, logging, run ledger, names, money
vcdo/lake/      content-addressed immutable object store
vcdo/sources/   hubspot, xero, gmail, drive (dlt as a library, no platform)
vcdo/curated/   models, transforms, crosswalk, data quality
deploy/Dockerfile   the worker image
deploy/compose/ service definitions (source of truth; Dokploy holds a copy)
flows/          Kestra workflows
migrations/     Postgres DDL for the curated layer
```

## Source reference

The legacy system at `vcc-ostwin-architecture-review` solves the same domain
problem on a single operator machine. It is the reference for domain rules —
entity identity, Xero API behaviour, currency and GST policy, PII handling — and
is **not** a dependency. Read it before designing; do not import from it.

## Safety

Client names are PII. Tracked files use CASE-IDs; real names live only in
restricted storage. `.dokploy.json`, tokens and `data/` are gitignored and must
never be committed.

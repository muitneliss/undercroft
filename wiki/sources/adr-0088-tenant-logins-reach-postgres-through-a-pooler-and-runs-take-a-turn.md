---
title: ADR 0088 Tenant Logins Reach Postgres Through A Pooler And Runs Take A Turn
type: source
date: 2026-09-29
tags: []
source: >-
  docs/adr/0088-tenant-logins-reach-postgres-through-a-pooler-and-runs-take-a-turn.md
source_path: >-
  docs/adr/0088-tenant-logins-reach-postgres-through-a-pooler-and-runs-take-a-turn.md
source_hash: 1e1b6f01be36275e071328b6d0ed332eb6c177d3ca05cd2f73caf8acc4c7cd37
ingested: 2026-09-29
---

# ADR 0088 Tenant Logins Reach Postgres Through A Pooler And Runs Take A Turn

# ADR 0088 Tenant logins reach Postgres through a pooler, and runs take a turn

Status: Accepted, 2026-09-29. Builds on [[ADR 0018: per-tenant roles and row-level security]], [[ADR 0087 A Tenant Login Is Leased Not Rotated Per Session]] and [[ADR 0051: A deploy stops a run at a safe point, and the run keeps its counts]].

## Context

About a thousand tenants are coming. Every tenant session connected straight to Postgres (default 100 connections, each a server process): a raw-lake query opened a fresh backend, a dbt build held five for its run, and a login's `CONNECTION LIMIT` refused rather than waited. Five or six busy tenants filled the server. And the worker started every run the moment it was asked: a Kestra tick of a thousand due pairs meant a thousand ingests, then a thousand dbt builds, in one 3 GB process.

## Decision

* **Tenant logins go through PgBouncer** (`pgbouncer` service, PgBouncer 1.25, configured by environment); the worker's own pool, the control plane and `db-migrate` stay on Postgres (bounded \~30; Better Auth needs its `-c search_path`).
* **Session pooling**, pooled per login (no forced user) so row-level security still keys on the tenant's own login; `DISCARD ALL` between clients. Transaction mode would break dbt temp tables and a tenant's `SET`.
* **Auth with no password file**: PgBouncer asks `ops.pgbouncer_auth(login)` (`430_pgbouncer_auth.sql`) as `undercroft_worker` at each client login; it returns the stored SCRAM secret only for a live tenant login. SCRAM pass-through lets PgBouncer log in with the client's own proof. `undercroft_worker` itself is in PgBouncer's password file and is the one platform role that can log in through it.
* **Pass-through is safe only because of the lease**: PgBouncer reuses the keys from a login's last successful client login, and ADR 0087 never rotates a login something holds; `MIN_POOL_SIZE` stays unset.
* **Limits**: 8 server connections per login, 50 for all tenants, the rest queued; each tenant login's `CONNECTION LIMIT` is 10 (above 8, so an exiting backend cannot turn a reconnect into a refusal). Postgres keeps `max_connections` 100.
* **Timeout chain**: 10 s queue wait, 15 s query, 30 s control plane; `pg` connect timeout 10 s; dbt `connect_timeout` 30 s with 3 retries; a session's lease covers two minutes because PgBouncer logs in lazily.
* **Busy is its own answer**: `53300`, PgBouncer's `query_wait_timeout` and kin, and `pg`'s connect timeout become `TenantBusy` in `tenantSession.ts`, the worker answers `503 tenant_busy`, and the control plane words `error.workerBusy`.
* **Runs take a turn** (`slots.ts`): builds 4, ingests 8, extracts 2, classification 2 (from the environment), editor builds 2 on turns of their own. A run is opened in the ledger first, waits inside its job, reads `running`, and journals `run_waiting`. An editor build waits at most 20 s, then closes busy. A run waiting when the process stops never starts and says so; a chained build is not opened while stopping, and one skipped for a running build is logged.

## Consequences

* Measured locally: 200 sessions across 50 tenants all succeeded with Postgres holding at most 50 tenant backends; 20 twelve-second queries on one login ran 8 at a time and the rest were refused as busy after 10 s.
* A server connection can outlive the password it was opened with by up to `SERVER_LIFETIME` (an hour); a client still proves the current password.
* Limits are per worker process; the pooler's cap holds for any number. A second worker is the next step for hourly builds at a thousand tenants (\~575 builds an hour on one worker): the lease must move into Postgres, shutdown and boot recovery must close only their own runs, and Kestra's calls must spread across workers.
* `task ci:itest` proves authentication through the real pooler; CI does not run it.

## Options rejected

* Raising `max_connections` (a process per connection exhausts memory first).
* Transaction pooling (breaks dbt temp tables and a tenant's `SET`).
* Pooling the platform's roles (Better Auth's startup option; already bounded).
* A password file for tenant logins (a stale second copy of a secret).
* Queueing in Kestra (the burst is the worker accepting all at once; the editor and control plane start runs Kestra never sees).

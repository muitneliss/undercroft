---
title: ADR 0087 A Tenant Login Is Leased Not Rotated Per Session
type: source
date: 2026-09-29
tags: []
source: docs/adr/0087-a-tenant-login-is-leased-not-rotated-per-session.md
source_path: docs/adr/0087-a-tenant-login-is-leased-not-rotated-per-session.md
source_hash: 8a9b44537910898f3e2338fab7a0e37abb8005c4aa6b17e83d578fcdea8b1c94
ingested: 2026-09-29
---

# ADR 0087 A Tenant Login Is Leased Not Rotated Per Session

# ADR 0087 A tenant's login is leased by the sessions that overlap it, not rotated for each one

Status: Accepted, 2026-09-29. Supersedes [[ADR 0018: per-tenant roles and row-level security]] on one point only -- "the worker holds the value for one dbt build or one pooled query session" -- and closes the worker-side fix [[ADR 0038 The Console Buffer Is a Script]] deferred.

## Context

Every build and query session as a tenant began with `ops.rotate_tenant_password`, a fresh password for that one use. A Postgres role has exactly one password, so each rotation refused every other use of the same login not yet authenticated. `dbt build` gets its password, parses for several seconds before its first connection, and opens more while it runs; a raw-lake query (`lake_query` over MCP, the CLI or the console) for the same tenant in that window rotated the dbt login and dbt's four threads failed with `password authentication failed`, exit 2 before any model. Seven builds of one tenant failed this way in a morning, each paired with a query inside the window. The BI login collided with itself the same way: concurrent `ALTER ROLE ... PASSWORD` answered `tuple concurrently updated`. The failure was hidden because the run kept the first 500 characters of dbt's last lines and the startup banner filled them (issue #336).

## Decision

* The worker leases a login: one lease per (tenant, login kind) in its memory. The first holder rotates; holders that overlap share that password; after the last lets go, the next rotates again. The password changes between uses, never during one.
* A holder states how long it needs the login (a pooled session to open, a build its whole deadline). When the shared password has less left, the worker calls `ops.extend_tenant_password` (`420_extend_tenant_password.sql`), which moves only `VALID UNTIL`, never earlier; `SECURITY DEFINER`, worker-only, reads and returns no password.
* Taking a lease is serialised per login; holding one is not, so a query never waits for a build.
* `TenantSessions` is the one door: `as` opens a pool on a lease, `withPassword` hands a leased password to dbt. `runTransform` no longer rotates directly.
* A build that stops before its first model records dbt's own cause: the error starts at "Encountered an error:", without dbt's per-line timestamps, and dbt runs with `--no-use-colors`. The 500-character bound stays and cuts the cause at its end.

## Consequences

* A tenant password is in worker memory while any build or session of the login runs, still never written anywhere, and still changes with each burst of use.
* Correct only while one worker process is the sole caller of the rotation; a second replica would need the lease in Postgres (an advisory lock and counted holders).
* The console's one-at-a-time queue is no longer needed for correctness; it stays.

## Options rejected

* A per-(tenant, login) mutex: a build holds its login up to half an hour, so every query would queue behind it.
* A single retry on an authentication failure: dbt is a child that only sees the refusal, and a retry that rotates refuses the other holder.
* A long-lived password minted once per worker process: the standing credential ADR 0018 set out not to have.
* A second read-only login for raw-lake queries: does not separate two builds, two queries or dashboard tiles, and adds a role to the grant model.

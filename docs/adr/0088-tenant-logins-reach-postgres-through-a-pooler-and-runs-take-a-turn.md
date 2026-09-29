# 88. Tenant logins reach Postgres through a pooler, and runs take a turn

- Status: Accepted
- Date: 2026-09-29
- Builds on: [ADR 0018](0018-per-tenant-roles-and-row-level-security.md) (a login per tenant,
  row-level security on the login), [ADR 0087](0087-a-tenant-login-is-leased-not-rotated-per-session.md)
  (the password lease), [ADR 0051](0051-a-deploy-stops-a-run-at-a-safe-point-and-the-run-keeps-its-counts.md)
  (runs stop at a safe point; no fourth run status).

## Context

The platform is about to host about a thousand tenants. Two things could not survive that.

**Connections.** Every tenant session connected straight to Postgres, which runs with its default
100 connections -- shared by every tenant and the platform, each one a server process. A raw-lake
query opened a fresh backend; a dbt build held five for its whole run. The only guard was each
login's `CONNECTION LIMIT`, and reaching it refused rather than waited: after v1.52.1 a query run
during a build answered "the worker did not respond". Worst case was 30 platform connections plus
12 per active tenant, so five or six busy tenants filled the server, and then no one, the platform
included, could connect.

**Work.** The worker started every run it was asked for at the moment it was asked (`jobs.ts`: "in
this process, with no queue"). A Kestra tick answers each due pair with 202 almost at once, so a
thousand due tenants were a thousand ingests in one 3 GB process, each followed by a dbt build --
a Python process and ~5 connections -- with nothing bounding the total.

## Decision

**Tenant logins go through PgBouncer; the platform's roles do not.**

- One `pgbouncer` service (`edoburu/pgbouncer`, PgBouncer 1.25) in both compose files, configured
  entirely by environment. The worker's tenant sessions and dbt connect to it
  (`UNDERCROFT_TENANT_POSTGRES_URL`, credential-less); the worker's own pool, the control plane and
  `db-migrate` stay on Postgres. They are few and bounded (~30), Better Auth needs its
  `-c search_path` startup option, and `db-migrate` is the superuser.
- **Session pooling.** Each tenant session is already one short-lived client, so session mode
  multiplexes them, and it keeps dbt's temp tables and a tenant's own `SET` working;
  `DISCARD ALL` wipes a server connection between two clients of the same login. Pools are per
  login -- no user is forced -- because row-level security keys on which login is connected.
- **Authentication without a password file.** Tenant passwords rotate, so PgBouncer asks
  `ops.pgbouncer_auth(login)` at every client login, as `undercroft_worker`. The function returns
  the stored SCRAM secret only for a live tenant login: never a platform role's, never an expired
  one's. PgBouncer checks the client's proof against it and logs in to Postgres with the client's
  own proof (SCRAM pass-through), so it never holds a password. `undercroft_worker` is PgBouncer's
  own login and is in its password file; it is the one platform role that can log in through it.
- **Pass-through is safe only because of the lease.** PgBouncer keeps the keys from a login's
  last successful client login and uses them for the next server login. A rotation while some
  holder still needed a new server login would leave it the old keys. ADR 0087 never rotates a
  login something holds, which closes that; it is also why `MIN_POOL_SIZE` stays unset (a
  pre-opened server login would need keys nobody has just proven).
- **Limits.** At most 8 server connections per login (`MAX_USER_CONNECTIONS`) and 50 for all
  tenants together (`MAX_DB_CONNECTIONS`), the rest queued. Each tenant login's own
  `CONNECTION LIMIT` is 10: above the pooler's 8, because a backend still exiting counts toward it
  and an equal limit turns a quick reconnect into a refusal and a login-retry stall. Postgres keeps
  `max_connections` 100 = 50 tenant + ~30 platform + 3 superuser + headroom; that is the point of
  the pooler.
- **One timeout chain.** A client waits at most 10 s in PgBouncer's queue, a query then runs at most
  15 s, and the control plane gives up on a query at 30 s. `pg` gives up a connection after 10 s
  (it waits forever by default); dbt waits 30 s with 3 retries. A session's lease covers two
  minutes, because PgBouncer logs in to Postgres lazily, at the first query.
- **"Busy" is its own answer.** A login with no connection in time -- Postgres's `53300`,
  PgBouncer's `query_wait_timeout` and kin, `pg`'s own connect timeout -- becomes `TenantBusy` in
  the one door every tenant session passes (`tenantSession.ts`), the worker answers `503
tenant_busy`, and the control plane says the customer's database is busy, to try again
  shortly. Before, it was a 400 quoting a pooler error as if the author's SQL had caused it.

**Runs take a turn.** `slots.ts` bounds how many runs of each kind this process does at once:
builds (4), ingests (8), extracts (2), classification runs (2), each from the environment, with
editor builds on turns of their own (2). A run is opened in the ledger first -- so the per-tenant
index keeps its place and the caller has its id at once -- then waits inside its job for a turn.
It reads `running` while it waits (a fourth status was rejected in ADR 0051) and says
`run_waiting` in its journal. An editor build waits at most 20 s, then closes as busy, and gets
what is left of its 120 s to run. A run still waiting when the process is told to stop never
starts, and closes saying so. A chained build after an ingest is not opened while stopping, and
one skipped because the tenant's build was already running is now logged.

## Consequences

- Hundreds of concurrent tenant sessions queue instead of failing: measured locally, 200 sessions
  across 50 tenants all succeeded with Postgres holding at most 50 tenant backends; 20 twelve-second
  queries on one login ran 8 at a time and refused the rest as busy after 10 s.
- A server connection can outlive the password it was opened with, by up to `SERVER_LIFETIME`
  (an hour); a client still has to prove the current password to reach it.
- The limits are per worker process. The global cap on Postgres is PgBouncer's and holds with any
  number of workers. **A second worker is not yet possible**, and is the next step for hourly builds
  at a thousand tenants (one worker at ~25 s per build and 4 turns is ~575 builds an hour): the
  password lease must move into Postgres (two in-process leases would rotate under each other),
  shutdown and boot recovery must close only their own process's runs (`closeAbandoned` closes
  every `running` row today), and Kestra's calls must be spread across workers.
- The Docker tier (`task ci:itest`) now proves authentication through the real pooler; CI does not
  run it.

## Options rejected

- **Raise `max_connections`.** Each connection is a server process with its own memory; a thousand
  would exhaust a 1 GB container long before the connections ran out, and a limit is still needed
  per tenant.
- **Transaction pooling.** It would multiplex idle clients we do not have, and it breaks dbt's temp
  tables and a tenant's `SET` in its own models.
- **Pool the platform's roles too.** Better Auth's startup option is refused by a transaction pool
  and ignored by a session pool, and the platform's ~30 connections are already bounded.
- **A password file for tenant logins.** Passwords rotate per use (ADR 0087); a file would be a
  second, stale copy of a secret the platform promises not to store.
- **Queue in Kestra instead of the worker.** Kestra's loop already serialises its calls; the burst
  is the worker accepting all of them at once, and the editor and the control plane start runs
  Kestra never sees.

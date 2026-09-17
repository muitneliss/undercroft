# 5. The role and grant model, and why BI cannot read raw

- Status: Accepted
- Date: 2026-09-17

## Decision

Five Postgres roles: `undercroft_owner` (NOLOGIN, owns everything), and login roles `_app`,
`_worker`, `_dbt`, `_bi`. Schemas: `app` (credentials, sessions — BI has no USAGE, ever),
`ops` (status, runs — BI reads named tables), `raw` (payloads — BI has no USAGE),
`analytics` and `dq` (owned by dbt). There is exactly one `ALTER DEFAULT PRIVILEGES` in the
whole database, scoped `FOR ROLE undercroft_dbt IN SCHEMA analytics`.

## Why

Because users author dbt models that create tables at runtime, the grant model is a
security boundary. The hazard is subtle: `ALTER DEFAULT PRIVILEGES` with no `FOR ROLE`
attaches to whichever role ran the migration, so under runtime table creation grants become
_unpredictable_, not merely broad. Four independent layers close it — dbt has no USAGE on
`app` (the primary control, a privilege not a policy); dbt can create only in
`analytics`/`dq`; exactly one scoped default privilege; and the master key is not in the
database. A gate test enumerates `pg_default_acl` and fails if a second default ever
appears.

BI cannot read `raw`, by the same argument that keeps it out of `dq`: raw payloads are
unreviewed source content, and a BI role that could read them turns every dashboard user
into someone with access to it. dbt's `store_failures` is pinned to `dq` so a failing test
never writes source data somewhere a dashboard can reach.

## Rejected

- **A table inside `ops` for credentials.** A broad default privilege on `ops` would
  silently grant the BI role read on every tenant's OAuth credential — the exact defect
  this model is built to prevent.

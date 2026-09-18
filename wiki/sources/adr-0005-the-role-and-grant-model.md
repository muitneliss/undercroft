---
title: ADR 0005 The Role and Grant Model
type: source
date: 2026-09-18
tags: []
source: docs/adr/0005-the-role-and-grant-model.md
source_path: docs/adr/0005-the-role-and-grant-model.md
source_hash: 481d967b1521f942d18a33bdc2761ea43787a4ccf5e98a9200c615771f2e72fa
ingested: 2026-09-18
---

# ADR 0005 The Role and Grant Model

## Decision

Five Postgres roles: `undercroft_owner` (NOLOGIN, owns everything) and login roles `_app`,
`_worker`, `_dbt`, `_bi`. Schemas: `app` (credentials, sessions — BI has no USAGE, ever),
`ops` (status, runs — BI reads named tables), `raw` (payloads — BI has no USAGE),
`analytics` and `dq` (owned by dbt). There is exactly **one** `ALTER DEFAULT PRIVILEGES` in
the whole database, scoped `FOR ROLE undercroft_dbt IN SCHEMA analytics`.

## Why

Because users author dbt models that create tables at runtime, the grant model is a
security boundary rather than configuration.

The hazard is subtle: `ALTER DEFAULT PRIVILEGES` with no `FOR ROLE` attaches to whichever
role ran the migration, so under runtime table creation grants become *unpredictable*, not
merely broad. Four independent layers close it:

1. dbt has no USAGE on `app` — the primary control, a privilege rather than a policy.
2. dbt can create only in `analytics` and `dq`.
3. Exactly one scoped default privilege.
4. The master key is not in the database.

A gate test enumerates `pg_default_acl` and fails if a second default ever appears.

BI cannot read `raw` for the same reason it cannot read `dq`: raw payloads are unreviewed
source content, and a BI role that could read them turns every dashboard user into someone
with access to it. dbt's `store_failures` is pinned to `dq` so a failing test never writes
source data somewhere a dashboard can reach.

## Rejected

* **A table inside `ops` for credentials.** A broad default privilege on `ops` would
  silently grant the BI role read on every tenant's OAuth credential — the exact defect
  this model is built to prevent.

## Related

The payload schema BI is kept out of is
[[ADR 0002 One Generic Raw Table, No Business Schema]].

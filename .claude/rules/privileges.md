---
description: The database role and grant model
globs: ["packages/db/sql/**/*.sql"]
---

# Privileges: who can read what, and why BI cannot read raw

Undercroft lets users author dbt models that create tables at runtime. That makes the
grant model a security boundary, not configuration.

## NEVER

- **NEVER write a second `ALTER DEFAULT PRIVILEGES`.** There is exactly one in the whole
  database — `FOR ROLE undercroft_dbt IN SCHEMA analytics GRANT SELECT ON TABLES TO
undercroft_bi`. The `FOR ROLE` clause is load-bearing: without it a default attaches to
  whoever ran the migration, and grants become unpredictable. A gate test enumerates
  `pg_default_acl` and fails if a second row ever appears.
- **NEVER grant the BI role USAGE on `app`, `raw`, or `dq`.** `app` holds sealed
  credentials, `raw` holds unreviewed source payloads, `dq` holds dbt's store_failures
  output (which contains source data). A dashboard user must reach none of them.
- **NEVER let dbt create outside `analytics` and `dq`.** dbt's role has no USAGE on `app`,
  so a model cannot read a credential; keep it that way.

## Follow

- Five roles: `undercroft_owner` (NOLOGIN, owns everything), `_app`, `_worker`, `_dbt`,
  `_bi`. Migrations `SET ROLE` to the owner; nothing logs in as it.
- The worker gets `SELECT, UPDATE` on `app.connection_secret` and nothing else in `app`.
- Every grant is explicit; `PUBLIC` is revoked.

The four layers that close the credential-leak hazard, and the tests that pin them, are in
`packages/db/sql/040_grants.sql` and `packages/db/src/privileges.test.ts`.

---
description: The database role and grant model
globs: ["packages/db/sql/**/*.sql"]
---

# Privileges: who can read what, and why BI cannot read raw

Undercroft lets users author dbt models that create tables at runtime. That makes the
grant model a security boundary, not configuration.

## NEVER

- **NEVER write an `ALTER DEFAULT PRIVILEGES` by hand.** Every one in the database is issued
  by `ops.provision_tenant`, scoped `FOR ROLE <the tenant's own dbt role> IN SCHEMA <that
role's own analytics schema>`, plus the one legacy row `FOR ROLE undercroft_dbt IN SCHEMA
analytics`. The `FOR ROLE` clause is load-bearing: without it a default attaches to whoever
  ran the migration, and grants become unpredictable. The gate test derives the expected set
  from `ops.tenant_role` and compares `pg_default_acl` in full, so a hand-written default
  and a forgotten tenant fail the same way. ADR 0018.
- **NEVER grant a BI role USAGE on `app`, `raw`, `ops` or any `dq*` schema.** `app` holds
  sealed credentials, `raw` holds unreviewed source payloads, `dq_<slug>` holds dbt's
  store_failures output (which contains source data). A dashboard reader must reach none of
  them, and a tenant's BI role reaches only `analytics_<slug>`.
- **NEVER let a dbt role create outside its own two schemas.** A tenant's dbt role owns
  `analytics_<slug>` and `dq_<slug>` and has `CREATE` nowhere else; `ops.guard_ddl()` is the
  tripwire behind that privilege. No dbt role has USAGE on `app`, so a model cannot read a
  credential; keep it that way.
- **NEVER key row-level security on a session setting or on `SET ROLE`.** A SQL author can
  `SET` any GUC and `RESET ROLE`; the only thing they cannot change is which login they are.
  `raw.tenant_of(current_user)` is the policy's one input.
- **NEVER store a tenant role's password.** `ops.rotate_tenant_password` mints one for the
  worker right before a build or a query session and returns it; the worker forgets it after.

## Follow

- Five platform roles: `undercroft_owner` (NOLOGIN, owns the schemas), `_app`, `_worker`,
  `_dbt` (legacy, matches no tenant and reads zero rows of `raw`), `_bi` (for an external SQL
  client). Plus **two LOGIN roles per tenant**, `undercroft_dbt_<slug>` and
  `undercroft_bi_<slug>`, recorded in `ops.tenant_role` — the only authority for which login
  belongs to which customer.
- **Migrations run as the bootstrap superuser** (`db-migrate` uses `POSTGRES_USER`), which
  therefore owns every table; `undercroft_owner` owns the schemas. The two `SECURITY DEFINER`
  functions in `080_tenant_isolation.sql` are owned by that bootstrap role and are the only
  code that creates a role, a schema or a default privilege.
- The worker gets `SELECT, UPDATE` on `app.connection_secret` and nothing else in `app`.
- Every grant is explicit; `PUBLIC` is revoked.
- **A migration that creates a table must grant that table in the same file.**
  `040_grants.sql` says `GRANT ... ON ALL TABLES IN SCHEMA app`, which Postgres expands to
  the tables that existed when it ran — and the ledger means it never runs again. So a table
  added later has **no grants at all**, and the symptom is "permission denied for table" at
  runtime while the whole suite stays green. `060_auth.sql` carries its own grants for this
  reason. The gate test enumerates every table in `app` rather than naming them, so it
  covers the next table too.

The four layers that close the credential-leak hazard, and the tests that pin them, are in
`packages/db/sql/040_grants.sql` and `packages/db/src/privileges.test.ts`.

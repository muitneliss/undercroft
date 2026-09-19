---
title: 'ADR 0018: per-tenant roles and row-level security'
type: source
date: 2026-09-19
tags: []
source: docs/adr/0018-per-tenant-roles-and-row-level-security.md
source_path: docs/adr/0018-per-tenant-roles-and-row-level-security.md
source_hash: f4f99999dbf93c31ed15ce8aa2f53fc941c9d253476e770d3f7e26a3d2c6e3b5
ingested: 2026-09-19
---

# ADR 0018: per-tenant roles and row-level security

Every tenant gets two LOGIN roles of its own (`undercroft_dbt_<slug>`, which builds, and `undercroft_bi_<slug>`, which reads) and two schemas (`analytics_<slug>`, `dq_<slug>`), because customers now author dbt models in the browser and a shared `undercroft_dbt` role would let one customer's SQL read every other customer's rows. `ops.tenant_role` is the only authority for which login belongs to which customer; two tenant ids that fold to one slug are refused, not merged.

`raw.records` and `raw.documents` carry row-level security keyed on the login: the platform roles see every row, a tenant login sees only its own tenant's rows through `raw.tenant_of(current_user)`, and the legacy `undercroft_dbt` sees none. A GUC and `SET ROLE` were rejected as keys because a SQL author can change both; only the login needs a password.

Two SECURITY DEFINER functions, owned by the bootstrap role that runs migrations (which therefore owns every table), are the only code that creates a role, a schema or a default privilege: `ops.provision_tenant(id)` (idempotent; app and worker) and `ops.rotate_tenant_password(id, kind, valid_for)` (worker only; generates a 256-bit password inside the function so no client statement carries it, sets it with VALID UNTIL, returns it; the worker keeps it in memory for one build or session).

Supersedes ADR 0005's "five roles" and "exactly one ALTER DEFAULT PRIVILEGES": now none is written by hand, and `pg_default_acl` must equal the legacy row plus one per tenant, which `privileges.test.ts` derives from `ops.tenant_role` and compares in full. dbt's role is granted the parent tables only, so naming a partition is a permission error rather than a way round the policy. The DDL guard reads the role name for its tripwire because the invoking role cannot read `ops`.

Costs recorded: the real-login half is proven in the Docker tier, not PGlite; two worker replicas would rotate each other's passwords; managed Postgres that refuses CREATE ROLE to the migration user cannot run the migration.

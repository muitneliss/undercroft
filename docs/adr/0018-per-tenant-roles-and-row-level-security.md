# 18. Each tenant's SQL runs as its own Postgres role, and raw refuses it every other tenant's rows

- Status: Accepted
- Date: 2026-09-19
- Supersedes: the "five roles" and "exactly one `ALTER DEFAULT PRIVILEGES`" clauses of
  [ADR 0005](0005-the-role-and-grant-model.md); qualifies ADR 0007's "dbt runs as
  `undercroft_dbt`"

## Decision

Every tenant gets **two LOGIN roles of its own** — `undercroft_dbt_<slug>`, which builds, and
`undercroft_bi_<slug>`, which reads — and **two schemas of its own**, `analytics_<slug>` and
`dq_<slug>`, owned by the first. `<slug>` is the tenant id folded to an identifier
(`CASE-0042` → `case_0042`); `ops.tenant_role` is the only authority for which login belongs
to which customer, and two ids that fold to one slug are refused, not merged.

`raw.records` and `raw.documents` carry **row-level security keyed on the login**: the
platform roles see every row, and any other login sees only the rows of the tenant that
`raw.tenant_of(current_user)` answers for it — which it answers only when the session
genuinely is that tenant's role.

Two `SECURITY DEFINER` functions are the only code that creates a role, a schema or a default
privilege, or that sees a tenant role's password in the clear:

- `ops.provision_tenant(id)` — idempotent; callable by the control plane and the worker.
- `ops.rotate_tenant_password(id, kind, valid_for)` — generates a 256-bit password, sets it
  with `VALID UNTIL`, returns it; callable by the worker only. The worker holds the value for
  one dbt build or one pooled query session and stores it nowhere.

ADR 0005's "exactly one `ALTER DEFAULT PRIVILEGES`" becomes: **none is ever written by hand**.
Every default is issued by `provision_tenant`, scoped `FOR ROLE <the tenant's own dbt role> IN
SCHEMA <that role's own schema>`, and `pg_default_acl` must hold exactly the legacy
`(undercroft_dbt, analytics)` row plus one per tenant. `privileges.test.ts` derives that set
from `ops.tenant_role` and compares it in full, so a hand-written default still fails the
gate, and so does a provisioning bug that forgets one.

## Why

Customers now author dbt models in the browser, and a model is SQL that runs. Under one
shared `undercroft_dbt` role that SQL could `SELECT * FROM raw.records` and read every other
customer's invoices; a `WHERE tenant_id = ...` macro the customer is trusted to keep is a
convention, not a boundary. The boundary has to be one the SQL author cannot cross from inside
a query, and there are only three things a Postgres session can be scoped by:

- **A GUC** (`SET undercroft.tenant = ...`) — settable by any SQL, including a model's
  pre-hook. Rejected.
- **`SET ROLE`** to a per-tenant role from a shared login — escapable by `RESET ROLE`, which
  returns to the shared login's privileges. Rejected.
- **The login itself** — changeable only with a password the SQL does not have. Chosen.

So isolation is a real login per tenant, and the policy asks `current_user`, not a setting.

**Why the functions are owned by the bootstrap role.** Creating roles needs `CREATEROLE`,
creating schemas needs `CREATE` on the database, and granting on `raw.records` needs to own
it. In every deployment this repo has, the migrations run as the bootstrap superuser
(`db-migrate` uses `POSTGRES_USER`), so every table is owned by it; `undercroft_owner` owns
the schemas and nothing inside them, and could not grant on a table it does not own. The
honest arrangement is two functions that do exactly one thing each, take an argument that is
identifier-quoted with `format('%I')` and re-validated inside, and are executable only by
the roles named in the migration. A compromised control plane can provision a tenant — which
it may do anyway — and cannot mint a password; a compromised worker can mint a password for a
tenant role, which is the capability it needs and already has by design (ADR 0016).

**Why the password is generated inside the function.** `ALTER ROLE ... PASSWORD '...'`
issued by a client is a statement `log_statement` and `pg_stat_activity` can record. Issued
from `EXECUTE` inside a `SECURITY DEFINER` body it is not, and the value is returned to the
one process that will use it and then forgotten. `VALID UNTIL` bounds a leaked value to an
hour.

**Why the parent tables only.** dbt's role is granted `SELECT` on `raw.records`, not on its
partitions. A query through the parent is filtered by the parent's policy; a query that names
`raw.records_default` directly is a permission error. Granting the partitions would have
offered a way around the policy.

**Why the DDL guard reads the role name.** The tripwire in `ops.guard_ddl()` runs as the
invoking role, which has no `USAGE` on `ops` and so cannot read `ops.tenant_role`. It derives
the two allowed schemas from `current_user` instead. That is acceptable for a tripwire behind
the privilege — the role has `CREATE` on nothing else — and unacceptable for a data decision,
which is why row-level security reads the table.

## What it costs

- The tenant-role login half of this — that a real `pg` connection as `undercroft_bi_x`
  with a rotated password sees only its schema and that `RESET ROLE` changes nothing — is
  proven in the Docker tier, not the offline gate. PGlite has no authentication, so `SET ROLE`
  from its superuser session is what stands in for a login there; `pg_has_role(session_user,
...)` is what lets the same policy work under both.
- Two worker replicas would rotate each other's passwords mid-build. A single worker is the
  stated deployment; the query runner treats an authentication failure as "rotate and
  rebuild", the build does not.
- Managed Postgres that refuses `CREATE ROLE` to the migration user cannot run this
  migration. The compose Postgres 17 is fine.
- The legacy shared `undercroft_dbt` matches no tenant and now reads zero rows of `raw`.
  Nothing runs as it once builds are per tenant; a zero it cannot mistake for data is the
  right answer for anything that still does.

## Rejected

- **A sealed per-tenant password table** (the shape of `app.connection_secret`). A second
  secret store, decryptable by anything holding `UNDERCROFT_SECRET_KEY`, whose rotation is a
  manual act. The function makes rotation the default and stores nothing.
- **Row-level security keyed on a session setting** set by the worker before it spawns dbt.
  A model's `pre_hook` can `SET` it to another tenant's id. See above.
- **One shared analytics schema with a tenant column** and a filter macro. Not a boundary.
- **Functions owned by `undercroft_owner` with `CREATEROLE`.** The plan's first draft. It
  founders on table ownership: the owner role does not own `raw.records` and cannot grant on
  it, and changing every table's owner to fix that is a migration no deployment needs.

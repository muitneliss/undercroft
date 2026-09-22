# 0036 — A definition is restated, not migrated

- **Status:** Accepted
- **Date:** 2026-09-22
- **Supersedes:** nothing. Amends the mechanism ADR 0024 and ADR 0026 each worked around.

## Context

The migration runner applies numbered `.sql` files once and records each in
`ops.schema_migration`. The ledger keys on a file's **name** and stores no checksum, which is
deliberate and stated in `migrate.ts`: editing an applied file reaches new databases only.

For a file that creates a table that is harmless — the table is already there. For a file
that defines a **function whose body is a policy** it is not, and `ops.provision_tenant` is
exactly that function: it decides which tables and functions every tenant's dbt login may
read.

Its grant list grew twice, both times by editing `080_tenant_isolation.sql` in place:

- ADR 0024 added `raw.document_text`, plus a catch-up loop in `180_document_text.sql`.
- ADR 0026 added the six search functions, plus the same loop in `190_raw_search.sql`.

Each catch-up loop granted to the tenants present in `ops.tenant_role` **the day it ran**.
Both files carried a comment claiming the in-place edit covered "a fresh database and every
tenant provisioned from here on". The first half is true. The second is not: in a database
where 080 had already run, the stored function body never changed, so every tenant
provisioned afterwards was built by the old one.

Production had that database. Of three tenants, the two created before the catch-up ran were
correct and the one created after held neither `SELECT` on `raw.document_text` nor `EXECUTE`
on any of the six search functions. It surfaced as `permission denied for table
document_text` in the Lake console — for a platform superadmin, who held every authority the
application had to give, because the console's SQL runs as `undercroft_dbt_<slug>` and no
application-level authority is a Postgres grant. Lake search was broken for the same tenant
and for the same reason.

**The gate could not see it.** Every test database is fresh, so 080's current text always
applies and the provisioning function under test is always the newest one. The defect lives
entirely in the difference between a fresh database and an upgraded one, which nothing in the
offline suite modelled.

## Decision

Split the SQL directory by what a file _is_.

- `packages/db/sql/*.sql` — **changes**, applied once, recorded in the ledger. Unchanged.
- `packages/db/sql/repeatable/*.sql` — **definitions**, re-applied on every run, after every
  numbered file, never recorded. A file here states a whole current definition with
  `CREATE OR REPLACE`; one that creates a table or inserts a row does not belong here.

`ops.provision_tenant` moves to `repeatable/010_provision_tenant.sql`, together with its
`REVOKE`/`GRANT EXECUTE`, and with the "every tenant that already exists" loop that used to
end 080. Those two halves are what make a grant added to the list reach both the next tenant
and the customers already here, on the next deploy, with no catch-up loop to remember.

`MigrateResult` gains `repeated`, and `migrate` reports it as `state <file>` rather than
folding it into `skip` — a deploy log silent about the step that repairs a grant would hide
the thing this ADR exists to make visible.

## Consequences

- **Adding a tenant grant is one edit again.** Add it to the list in the repeatable file.
  No second copy, no catch-up loop, no reasoning about which databases the edit reaches.
- **Every tenant is re-provisioned on every migrate.** Each statement in the function is
  idempotent, and this is a customer list, not a row count. If it ever stops being cheap,
  that is a good problem and a different file.
- **A repeatable file must stay idempotent, and nothing enforces that but review.** This is
  the cost of the mechanism. It is bounded by keeping the directory small and by the rule
  above: definitions only.
- **The two catch-up loops in 180 and 190 stay where they are.** They have run; editing an
  applied migration to tidy history is the thing this ADR is about not relying on.
- **The gap this closes was in the harness, not only in the SQL.** `migrate.test.ts` now pins
  the boundary from both sides: a revoked tenant grant is restored by the next `migrate`, and
  a policy dropped from a numbered migration stays dropped. Without the second, "re-apply the
  repeatable files" would be indistinguishable from "re-apply everything".

## Options rejected

**A checksum in the ledger, so an edited migration re-runs.** Closes the same class, and
more of it. Rejected because it makes every numbered file's idempotence load-bearing
retroactively — 23 files written under the promise that they run once would begin running
again whenever touched, including files that `INSERT`, and the blast radius of a typo becomes
the whole schema. The narrow mechanism buys the fix without that.

**Another one-shot catch-up loop, in a new numbered migration.** What 180 and 190 each did.
It would have repaired the tenant in production and left the next one to break the same way;
the user asked for the root cause, and this is not it.

**Have the worker call `provision_tenant` before every build as the repair path.** It already
calls it as belt and braces, which is why the tenant's _other_ grants were right. It cannot
help here: the function it calls is the stale one. A stale definition cannot repair itself.

---
title: ADR 0036 — A definition is restated, not migrated
type: source
date: 2026-09-22
tags: []
source: docs/adr/0036-a-definition-is-restated-not-migrated.md
source_path: docs/adr/0036-a-definition-is-restated-not-migrated.md
source_hash: a1a777bc42577b489539c0b8c3ff107b4ea6a542a47a7365757df30380188675
ingested: 2026-09-22
---

# ADR 0036 — A definition is restated, not migrated

The migration ledger keys on a file's **name** and holds no checksum, so editing an already-applied migration reaches new databases only. That is harmless for a file that creates a table, and a silent defect for one that defines a function whose body is a policy.

`ops.provision_tenant` is exactly such a function: it decides which tables and functions every tenant's dbt login may read. Its grant list grew twice by editing `080_tenant_isolation.sql` in place — `raw.document_text` (ADR 0024) and the six search functions (ADR 0026) — each with a one-shot catch-up loop covering the tenants that existed the day it ran. In an upgraded database the stored function body never changed, so any tenant provisioned afterwards was built by the old one.

Production held that state: of three tenants, the two created before the catch-up were correct and the one created after could read neither `raw.document_text` nor its own search index. It surfaced as `permission denied for table document_text` in the Lake console, for a platform superadmin — because the console's SQL runs as `undercroft_dbt_<slug>` and application authority is never a Postgres grant. The offline gate could not see it: every test database is fresh, so the newest function body always applies.

**Decision.** The SQL directory is split by what a file *is*. `packages/db/sql/*.sql` are changes, applied once and recorded in the ledger. `packages/db/sql/repeatable/*.sql` are definitions, re-applied on every run after every numbered file and never recorded; a file there states a whole current definition with `CREATE OR REPLACE`. `ops.provision_tenant` moved to `repeatable/010_provision_tenant.sql` together with its grants and with the "every tenant that already exists" loop that used to end 080. `MigrateResult` gains `repeated`, reported as `state <file>` rather than folded into `skip`.

Consequence: adding a tenant grant is one edit to one list again, and it reaches both the next tenant and the customers already here at the next deploy. The cost is that a repeatable file must stay idempotent, which only review enforces, and that every tenant is re-provisioned on every migrate — cheap, because it is a customer list rather than a row count. `migrate.test.ts` pins the boundary from both sides: a revoked tenant grant is restored by the next migrate, and a policy dropped from a numbered migration stays dropped.

Rejected: a checksum in the ledger (makes 23 files' idempotence load-bearing retroactively, including ones that INSERT); another one-shot catch-up loop (repairs one tenant, leaves the next to break); having the worker call `provision_tenant` as the repair path (it already does — the function it calls is the stale one, and a stale definition cannot repair itself).

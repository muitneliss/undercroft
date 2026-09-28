---
title: ADR 0077 Deleting a Model Drops What It Built
type: source
date: 2026-09-28
tags: []
source: docs/adr/0077-deleting-a-model-drops-what-it-built.md
source_path: docs/adr/0077-deleting-a-model-drops-what-it-built.md
source_hash: a09b07329d5e7eda534a6e627d9457b48abc8cd8e97c48fe8c3006d813d6ff0a
ingested: 2026-09-28
---

# ADR 0077 Deleting a Model Drops What It Built

# ADR 0077 Deleting a model drops what it built, or deletes nothing

Status: Accepted, 2026-09-28.

## Context

`models.delete` removed only the `app.model` row. The relation dbt built stayed in `analytics_<slug>`, still listed by `bi.schema` and read by `bi.answer`, and the failing rows its tests stored stayed in `dq_<slug>`: dbt replaces what it builds and never drops what it no longer builds. The editor claimed the table "stays until the next build", which was false. One tenant (CASE-0042) held eight such tables, one with names, emails and phone numbers, and no door could drop one.

## Decision

* **Drop first, then delete the row** (`services/models.ts` `remove`). A worker that is down, unconfigured, or fails part-way leaves the row, answered `PRECONDITION_FAILED` "not deleted, the model is still here". All drops are one transaction on the tenant session.
* **The worker drops, as `undercroft_dbt_<slug>`**, the relations' owner, whose password only the worker mints ([[ADR 0016 The Worker Seals the Control Plane Consents]]). No grant is added. `POST /v1/models/drop`, `WorkerClient.dropModel`.
* **By name, from the catalogue, never the ledger** (`relationsOfModel` in `dbtProject.ts`, `relationsToDrop` in `apps/worker/src/services/modelDrop.ts`): the model's relation plus dbt-postgres's `__dbt_tmp` / `__dbt_backup` working copies in analytics; each declared test's failing-rows table in dq, named as dbt 1.9 does (`<kind>_<model>_<column>`, or 30 characters plus the md5 of the full name at 64 or more); and any other `<kind>_<model>_...` dq table read as belonging to the model with the LONGEST matching name. A name another model owns is never taken. Existing orphans are reachable by re-creating and deleting a model of the same name.
* **dq goes too**: store\_failures output is source rows verbatim.
* **A running build refuses twice**: the worker refuses the drop (409 `run_in_progress`), and the row's DELETE is conditional on no running transform in the same statement (`deleteModelUnlessBuilding`).
* **RESTRICT, never CASCADE**: views or materialized views reading a doomed relation refuse the drop, 409 `relation_depended_on` naming them, worded as a CONFLICT. A table built from it by `ref()` is that model's own copy and does not block.
* Table, partitioned table (incremental), view and materialized view each get their own DROP; ephemeral, never-built and unprovisioned tenants drop nothing and are deleted. Identifiers pass `quoteIdent`.

## Consequences and limits

"Deleted" means nothing it built is readable. Deleting needs the worker. The audit entry names what was dropped. Not reached: a dbt `alias`, and a hashed dq table of a test no longer declared. The production orphans are not swept; a sweep is a separate destructive decision. Proven in PGlite under `SET ROLE` (ownership is decided on `current_user`); no new Docker-tier test.

## Rejected

Delete the row first (the defect). A background sweep of unclaimed tables. The worker deleting the row too (a second writer of `app.model`). Holding the ledger lock with a fake transform run. `DROP ... CASCADE`. Dropping what the ledger recorded (misses every pre-existing orphan). Leaving dq alone.

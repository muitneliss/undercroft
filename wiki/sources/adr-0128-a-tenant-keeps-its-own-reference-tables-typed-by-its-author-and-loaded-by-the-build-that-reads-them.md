---
title: >-
  ADR 0128 A Tenant Keeps Its Own Reference Tables, Typed by Its Author and
  Loaded by the Build That Reads Them
type: source
date: 2026-10-13
tags: []
source: docs/adr/0128-a-tenant-keeps-its-own-reference-tables.md
source_path: docs/adr/0128-a-tenant-keeps-its-own-reference-tables.md
source_hash: 90ec65316919a1a9f19b09715a8583955681b8ceaeb01fd4eb1024bd7eae61bf
ingested: 2026-10-13
---

# ADR 0128 A Tenant Keeps Its Own Reference Tables, Typed by Its Author and Loaded by the Build That Reads Them

Issue 446. Agents inlined hand-kept lookup tables into model SQL as `VALUES` and resent the whole model on every change: in an audit of 655 `models.save` calls, 368 carried a `VALUES` list, 9.1 M of 11.5 M characters. A tenant now keeps small reference tables as dbt seeds, which a model reads with `{{ ref('name') }}`.

Decision. Seeds are stored in `app.seed` (migration 540): `tenant_id`, `name` (the model identifier rule), `columns` jsonb `[{name, type}]`, `rows` jsonb (arrays of string or null), created/updated at and by, primary key `(tenant_id, name)`. `undercroft_app` has all four verbs, `undercroft_worker` SELECT; Postgres is the only copy and every build renders the seeds into its throwaway project, like `app.model` and `app.macro` ([[ADR 0086 A Tenant Writes Its Own Macros]]). Procedures `seeds.list` (summaries with `columnCount`, `rowCount`, `sha256`, `names`/`match`), `seeds.get`, and admin-only `seeds.save` and `seeds.delete`. Types are declared, never inferred, from `text`, `integer`, `bigint`, `numeric(18,4)`, `boolean`, `date`, `timestamptz`; every cell is checked against its type in `packages/contracts/src/seeds.ts`, and money stays a string into `numeric(18,4)`. `null` is NULL; an empty, whitespace-only or `null`-looking text cell is refused (`reads-as-null`) because dbt's loader would load it as NULL; a `\r`, a NUL, a lone surrogate or an over-long cell is refused too. Bounds: 10,000 rows, 100 columns, 1 MB, each refusal a BAD\_REQUEST worded Vietnamese first with `reason`, `row` and `column` as facts. The hash is computed in SQL over `jsonb_build_array(columns, rows)`; an identical re-save answers `unchanged: true` and writes no audit row ([[ADR 0127 Lists Answer Summaries, the Server Hashes What It Stores, and an Identical Save Writes Nothing]]); the audit row names the seed, never a cell. `seeds` is a part of `models.revision`.

Rendering: `seeds/<name>.csv`, RFC 4180 with every value quoted and NULL as the empty unquoted field; `seed-paths`, `+quote_columns: true` and per-seed `+column_types` with every key a quoted YAML string (YAML 1.1 would read a bare `on` or `no` as a boolean); `+full_refresh: true` only when the standing table's columns or types differ from the declaration. A build's selection gains the seeds each selector reaches (`1+name,resource_type:seed`, `+name,...`, `@name,...`) when the tenant has seeds; seed steps are recorded in `ops.run_step` (kind widened in migration 550) and a failed seed fails the run. A tenant with seeds and no models still builds. A seed and a model never share a name, refused both ways. `models.check`, the tests' `relationships.to` and SQL tests ([[ADR 0130 A Rule About a Model's Rows Is a Test of That Model, Not a Model of Its Own]]), and lineage (a `seed` node kind) know seeds. `seeds.delete` is a CONFLICT naming the models that read it by `ref()` or in a test; otherwise the worker drops its table as the dbt login ([[ADR 0077 Deleting a Model Drops What It Built]]) and the row goes.

Rejected: inline `VALUES`, landing a CSV in the raw lake, type inference, coercing bad cells, accepting an empty text cell as the empty string, seeds as files in git, and `models.save` edit patches. Follow-ups: CSV input to `seeds.save`; editing seeds in the UI, which shows a read-only list in the model editor's reference panel.

---
title: ADR 0086 A Tenant Writes Its Own Macros
type: source
date: 2026-09-29
tags: []
source: docs/adr/0086-a-tenant-writes-its-own-macros.md
source_path: docs/adr/0086-a-tenant-writes-its-own-macros.md
source_hash: 3d10a3a51bd3d8718847e9cdf747498554d1f6b0928a3b4449cb1c1aee9e3406
ingested: 2026-09-29
---

# ADR 0086 A Tenant Writes Its Own Macros

# ADR 0086 A tenant writes its own dbt macros, and dbt no longer sees the worker's environment

Status: Accepted, 2026-09-29. Builds on [[ADR 0007 dbt Runs as a Subprocess in the Worker]], [[ADR 0018: per-tenant roles and row-level security]], [[ADR 0077 Deleting a Model Drops What It Built]] and [[ADR 0067: The published skills are one family, installed by npx skills and served by /mcp]].

## Context

A tenant's dbt project carried only the platform's three macros (`parse_amount`, `generate_schema_name`, `gmail_letters`), so a repeated expression -- a company name brought to one form -- was copied into every model and the copies drifted. A macro file differs from a model: a macro in the root project silently replaces one of the same name that dbt or the platform ships (`generate_schema_name`, `test_not_null`, `postgres__create_table_as`), and each such override builds green while meaning something else. Separately, the worker spawned `dbt build` with its whole `process.env`, so `{{ env_var('UNDERCROFT_SECRET_KEY') }}` in a model could copy the master key, the worker DSN or OAuth secrets into a tenant-readable table.

## Decision

* `app.macro` (tenant, name, required description of 1-500 chars, whole definition), in `app` like `app.model`; the control plane writes, the worker has SELECT (`410_macros.sql`).
* One row is one whole `{% macro name(args) %} ... {% endmacro %}`. `macros.save` hard-refuses with `BAD_REQUEST` and a worded reason: `not-one-macro` (anything but comments outside the block, or a second block), `name-mismatch`, `forbidden-block` (`materialization`, `test`, `data_test`, `snapshot`, `docs`) and `reserved-name`. One block reader, `jinjaBlocks` in `jinja.ts`, skips strings inside a tag and honours `{% raw %}` as Jinja does, so a block cannot hide inside a string.
* Reserved: the platform's `MACROS`, every `DBT_CONTEXT` name, any name containing `__`, prefixes `generate_`, `test_`, `materialization_`, plus `should_full_refresh` and `get_where_subquery`; the list lives only in `macroDefinition.ts`.
* Every macro of the tenant is rendered on every build to `macros/tenant/<name>.sql`.
* `models.check` takes the tenant's macro names so a call to one is not `unknown-macro`; `models.reference` returns `tenantMacros`. `macros.check` reports the refusals as errors, then unknown calls, `unbound-name`, `ref()`/`source()` findings, `;` and write keywords.
* `macros.delete` answers `CONFLICT` naming every model and other macro whose Jinja calls it.
* Procedures `macros.list`, `macros.get`, `macros.check` (any member), `macros.save` and `macros.delete` (admin; `write` and `destructive`), audited as `macros.save` / `macros.delete`. The assistant gets none of them, as it has no `models.save`. The web UI shows tenant macros read-only in the model editor's reference panel.
* dbt's environment is an allowlist: `PATH`, `HOME`, `TMPDIR`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TZ`, `SSL_CERT_FILE`, `SSL_CERT_DIR`, plus the tenant's password in `UNDERCROFT_DBT_PASSWORD` (`CHILD_ENV` in `apps/worker/src/services/transform.ts`).

## Consequences

* An expression is written once; the model-builder skill proposes a macro when it would repeat.
* A broken macro fails every build of its tenant, since dbt parses the whole project first.
* The delete guard is application code: a model saved calling a macro in the instant it is deleted fails its next build with dbt's own error.
* A platform macro added later takes a name a tenant may hold; dbt refuses two macros of one name, so a new platform macro is checked against `app.macro` before it ships.
* A stored macro a later rule would refuse is still rendered; `macros.list` reports its parameters as `null`.
* dbt's other global macros (`create_table_as`...) can be overridden, affecting only the tenant's own build inside its own grants.
* A variable a future dbt needs must be added to `CHILD_ENV` by name.

## Options rejected

* A local dbt package per tenant, namespaced: every call would need the namespace and every build a `dbt deps`.
* Macros inline in a model's SQL: only that model could call them.
* No name reservation: the failures it prevents build green.
* Removing known secrets from the environment instead of allowlisting: the next secret would leak by default.

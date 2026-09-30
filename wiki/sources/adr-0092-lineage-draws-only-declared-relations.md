---
title: ADR 0092 Lineage Draws Only Declared Relations
type: source
date: 2026-09-30
tags: []
source: docs/adr/0092-lineage-draws-only-declared-relations.md
source_path: docs/adr/0092-lineage-draws-only-declared-relations.md
source_hash: 4a7e37832d9e1d39bc1c690b9650f2d28971f9c9b425b9633363e5e582ccb5c4
ingested: 2026-09-30
---

# ADR 0092 Lineage Draws Only Declared Relations

# ADR 0092 Lineage draws only the relations the models declare

Status: Accepted, 2026-09-30. Refs #346 and the design contract `docs/design/operator-and-reader-paths.md`. Builds on ADR 0002 (one generic raw table), ADR 0019 (the wheel is full), ADR 0043 (a second account is a second source), ADR 0077 (deleting a model leaves the models that ref it) and ADR 0086 (a tenant's own macros).

## Context

Following a model's inputs meant opening every model's SQL. A lineage view is easy to make look complete and hard to make true: an edge from an account a model filters on, to a dashboard, or between look-alike names would be guessed, and a guessed edge reads exactly like a declared one. A missing edge reads as proof of no dependency. Both break rule 2.

## Decision

* **`models.lineage`**: read-only, `models.list`'s gate (any member), reaches CLI and MCP through the router. Computed per call from the saved models' and macros' text by `modelLineage.ts` in `packages/db`, never stored.
* **An edge is a declaration**: model → model for a literal `ref('m')`, raw lake table → model for a literal `source('undercroft', 't')`. No source-account, report, question or dashboard nodes.
* **Macros count for their callers**, transitively and cycle-safe; `gmail_letters()` gives its caller the raw records; the edge names the macro holding the declaration.
* **"Upstream not declared"**, with reasons, for a non-literal ref/source, a call to a macro the project does not hold, a relation named directly (`raw-direct`, `analytics-direct`, or a table of a declared source's schema after `from`/`join` such as `raw.document_text`), or a query run from Jinja (`run_query`, `statement`).
* **A ref to a missing model is a missing-dependency node with its edge kept** (ADR 0077); so is a `source()` naming an undeclared table.
* **A view of the Models division** at `/tenants/:id/models?view=lineage&model=<name>`, not `/models/lineage`, which would shadow a model named `lineage`.
* Selecting a model highlights its upstream chain and dims the rest, said in words on each node and in a text list, which is the whole view below 760px. Plain HTML and SVG on a fixed grid; no graph library.

## Consequences

* The picture is only as complete as the declarations; an undeclared read is shown with its reason, never as no parents.
* Relations to accounts and reports stay undrawn until they have a declared contract.
* A new way to read (a second source, a dbt package) must be taught to `modelLineage.ts`, or its models are marked undeclared — failing loud.
* The graph is recomputed per request; a cache keyed by `updated_at` is the answer if that grows costly.

## Rejected

* Inferring edges from names, filters or data.
* dbt's manifest (`dbt parse`): needs the worker, parses the whole project per view, and fails outright on one broken model.
* Dropping a ref to a deleted model.
* A `/models/lineage` path.
* A graph library such as `@xyflow/react`.

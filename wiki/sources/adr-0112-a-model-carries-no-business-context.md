---
title: ADR 0112 A Model Carries No Business Context
type: source
date: 2026-10-06
tags: []
source: docs/adr/0112-a-model-carries-no-business-context.md
source_path: docs/adr/0112-a-model-carries-no-business-context.md
source_hash: dad3f837952edb4a38ca3fc2b06f2b9d42ad2bb778fcbbedf8b0055a1cae52df
ingested: 2026-10-06
---

# ADR 0112 A Model Carries No Business Context

Reverses [[ADR 0105 A Model Carries One Business Context, Reviewed Against Its Definition]] in full. ADR 0105 gave every model one approved business context -- purpose, grain, key, column meanings and units, rules -- with a state (`incomplete`, `needs_review`, `current`) derived on read from a fingerprint of the model and the models it reads directly. Production showed it did not belong: Undercroft is for people who write dbt SQL and tests, not prose documentation; all 183 models of the production tenant had an empty context, so the table held no row; every model carried an `incomplete` badge, the "flag on everything" ADR 0105 itself warned against; `current` verified nothing about the data, which only the model's `unique` and `not_null` tests check; and it cost about 2,700 lines plus a lineage read on every `models.get` and `models.list`.

Decision. The feature is removed entirely. `models.setContext` leaves the router, and so the CLI and `/mcp`; `models.list` and `models.get` carry no `context` field and `models.get` reads one model again. The contract's `ModelContext`, `services/modelContext.ts`, `repos/modelContext.ts`, their strings, the model editor's context band, the model list's context column and the browser's draft go. `500_drop_model_context.sql` drops `app.model_context`; `460_model_context.sql` stays because the migration ledger keys on file names and a change is undone by a later migration ([[ADR 0036 — A definition is restated, not migrated]]). The `undercroft-model-builder` skill returns to its pre-#389 interview -- no key, unit or rules questions, no save step, no `references/context-audit.md`. A model's meaning lives in the skill's brief and in its tests, as before.

Consequences: a call to `models.setContext` meets a procedure that does not exist (none ever succeeded); a reader of `context` finds it absent; a fresh database creates the table at 460 and drops it at 500; the model list and editor visual baselines are retaken. Rejected: keeping the backend and hiding the UI, keeping only the skill's questions, keeping it and waiting for use, and hiding the badge on empty contexts.

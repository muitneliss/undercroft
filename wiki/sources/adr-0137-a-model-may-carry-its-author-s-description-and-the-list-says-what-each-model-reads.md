---
title: >-
  ADR 0137 A Model May Carry Its Author's Description, and the List Says What
  Each Model Reads
type: source
date: 2026-10-15
tags: []
source: docs/adr/0137-a-model-may-carry-its-authors-description.md
source_path: docs/adr/0137-a-model-may-carry-its-authors-description.md
source_hash: 40dd2e3f5d4f23f2d6131f9a3416ed26c710a053996c1db82e238560c39f9f46
ingested: 2026-10-15
---

# ADR 0137 A Model May Carry Its Author's Description, and the List Says What Each Model Reads

Accepted 2026-10-15. Supersedes in part [[ADR 0112 A Model Carries No Business Context]]: its removal of the business context stands whole (no `models.setContext`, no flag, no interview question, no lineage read on `models.get`); only its closing sentence, which left model documentation to "a new decision about who writes it, for whom, and what checks it", is answered here. Extends [[ADR 0092 Lineage Draws Only Declared Relations]], ADR 0127 (summaries, server-side hashes, an identical re-save writes nothing) and ADR 0133 (paged lists).

**Context.** People asked for two columns on the model list: what a model is, and what it depends on. Dependencies already existed in `modelLineage`, read from each model's declared `ref()`/`source()` through its macros, but `models.list` did not answer them. A description had nowhere to go: `app.model` held only SQL and tests, although dbt's `schema.yml`, which the platform writes, has a `description:` per model.

**Decision: a description, optional, the author's, checked by nothing.** The author writes it when they want to through `models.save` (the editor's field, the CLI's `--description`, an MCP client's `description`); it is for the person reading the list, an agent choosing a model (the model-builder skill offers the brief's grain sentence), and dbt's manifest. Nothing checks what it says; the tests remain the only verified statement about a model's rows. No `incomplete`, no badge, no state, no required question. `app.model.description` is `text NULL`, 1 to 1000 characters (`580_model_description.sql`). Neither `{` nor `}` is allowed, in the contract (`ModelDescription`) and a CHECK, because dbt renders a description through Jinja at parse time and an invalid one fails the whole tenant's project, the same reason `accepted_values` refuses braces. `models.save` reads the field three ways: a string sets it, `null` clears it, and leaving it out keeps the stored one, decided inside the one upsert so an identical re-save stays `unchanged`; absent-means-clear would erase descriptions on every save by a caller that never heard of the field. The revision moves when a description does, its hash joining a model's entry only where there is one, so models without a description keep their revision. `schema.yml` gets an entry for a model with tests or a description; a model with neither is still absent. The list shows a description muted under the name, two lines at most.

**Decision: dependencies, computed and only when asked.** `models.list` takes `include: ["dependsOn"]` and answers per model `reads` (kind `model`/`seed`/`raw`/`missing`, name, `via` macro) and `undeclared` reasons. Empty `reads` with reasons is not "reads nothing" (rule 2); the list writes "upstream not declared" there. It is the same graph `models.lineage` answers, cut per model by `dependsOnByModel` in `@undercroft/db/services`, computed on every call that asks and never stored (ADR 0092's reason), and opt-in because it reads every model and macro however small the page (issue 444).

**Consequences.** A nullable column, no row changed; `models.list` and `models.get` answer `description`; a save that changes a description is a write (updatedAt, audit row, revision); dbt's manifest carries each description; the editor gains a field and the list a dependencies column, so their visual-regression baselines were retaken.

**Rejected.** Required like a macro's description (would refuse every save of the existing models, ADR 0112's failure as a refusal); column-level descriptions (where ADR 0105 grew from); storing dependencies on the model row (stale after any ref'd save, macro edit or seed); `dependsOn` on `models.get` (ADR 0112 returned `get` to one model); absent means clear; a separate `models.setDescription` (two writes, and it could not join the identical-re-save decision).

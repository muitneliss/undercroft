---
title: >-
  ADR 0130 A Rule About a Model's Rows Is a Test of That Model, Not a Model of
  Its Own
type: source
date: 2026-10-13
tags: []
source: docs/adr/0130-a-rule-about-a-models-rows-is-a-test-of-that-model.md
source_path: docs/adr/0130-a-rule-about-a-models-rows-is-a-test-of-that-model.md
source_hash: 30b2aaab2d4ba96ff65a70d3fc9c01a1f47f36c7008410f01e6e18cbb5a91892
ingested: 2026-10-13
---

# ADR 0130 A Rule About a Model's Rows Is a Test of That Model, Not a Model of Its Own

Extends ADR 0005 (failing rows are stored in `dq_<slug>`, which BI cannot read) and ADR 0127 (the server hashes what it stores; an identical save writes nothing). Issue 458: a model could declare only `not_null` and `unique`, so every other business rule became a `chk_*` check model counting violations and tripping a `not_null`/`unique`; one tenant had about 25, which grew lineage and `bi.schema` with tables that are not business data.

Decision. `ModelTests` (`packages/contracts/src/models.ts`) takes per-column tests as a bare kind (the short form every stored row is already in) or an object naming its kind: `not_null`, `unique`, `accepted_values` with `values` (strings only, 1-100, no brace or control character; with `quote: false` each a plain decimal, never a JSON number, per money.md) and `relationships` with `to` (a model name, a seed once seeds land) and `field`; each kind once per column. A model-level `sql` list holds SQL tests `{ name, sql }`, each a SELECT of the rows that break the rule; names are lowercase words joined by single underscores, never `__`, unique within the model. Every test takes `severity: error | warn`. The schema is strict. No migration: old rows parse unchanged and keep their `testsSha256`; `canonicalTests` gives one meaning one spelling before a save (`{"kind":"not_null"}` is `"not_null"`, `severity: error` is omitted, no SQL tests is no `sql` key) so no-op saves and hashes hold.

Rendering (`dbtProject.ts`) uses dbt 1.9 syntax: arguments as the test's top-level properties and severity under `config:` (1.10.5's `arguments:` would be misread by the pinned dbt-core 1.9.1); `relationships.to` is `ref('<model>')`; accepted values are YAML strings with single quotes doubled, since dbt splices them into `'...'` unescaped. A SQL test is a singular test at `tests/<model>__<name>.sql` (`test-paths: ["tests"]`), a warn one starting with `{{ config(severity = 'warn') }}`; its failing rows land in `dq_<slug>` through the project's `+store_failures`.

Safety: `checkTests` (`modelCheck.ts`) holds each SQL test to the model checks (one statement, no write, known refs and sources, no relation read around dbt) by reusing them, plus three errors: `test-model-unread` (no `ref()` of its own model, so dbt would neither order nor select it with the model), `test-forbidden-call` (`config`, `run_query`, `statement`, `adapter`: could move failing rows out of dq or run SQL the lexer never sees) and `test-name-too-long` (`<model>__<name>` past 63 characters). A `relationships.to` naming no model is `unknown-ref`. `models.check` reports these with the finding's `test`; `models.save` refuses the first error (BAD\_REQUEST, worded, Vietnamese first) and writes nothing, unlike model SQL, because a broken test lives in a field no form edits and fails the compile of the tenant's whole project. The tenant's dbt login's grants stay the security boundary.

Run recording: a singular test's `unique_id` is `test.undercroft.<model>__<name>` (no hash); attribution to the model is issue 456's (manifest `depends_on`, which contains the model because the test must `ref()` it; else everything before the last `__`). A warn result is status `warn`: recorded, visible, not in `testsFailed` (which counts `fail` and `error`), never `pass`. `dq.failures` is unchanged. `relationsOfModel` names the new failing-rows tables as dbt 1.9's `synthesize_generic_test_names` does, so deleting a model drops them. The model editor's draft carries the stored tests whole and sends back what its form cannot edit.

Consequences: check models can become tests and the model-builder skill teaches that; a model must exist before another's test names it, and deleting one leaves such a test naming nothing, as a model `ref()` already does; seeds (issue 446) must join the names `checkTests` admits. Rejected: accepted\_values/relationships only (no cross-column or aggregate rules), dbt 1.10's `arguments:`, a migration to object form (changes every hash for nothing), advisory-only checks (a bad test breaks every build), and JSON-number values.

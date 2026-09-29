---
title: ADR 0085 A Document Is Classified Into Its Tenants Own Catalogue Of Kinds
type: source
date: 2026-09-29
tags: []
source: >-
  docs/adr/0085-a-document-is-classified-into-its-tenants-own-catalogue-of-kinds.md
source_path: >-
  docs/adr/0085-a-document-is-classified-into-its-tenants-own-catalogue-of-kinds.md
source_hash: 2b5c0f1dd18345af55639569dd1e4f1282804c82f3c136aff912a35fd06eeb95
ingested: 2026-09-29
---

# ADR 0085 A Document Is Classified Into Its Tenants Own Catalogue Of Kinds

# ADR 0085 A document is classified into its tenant's own catalogue of kinds, drawn from a generic one

Status: Accepted, 2026-09-29. Builds on [[ADR 0024: A document's text is readable by dbt]] and [[ADR 0084 A Gmail Harvest Lands Each Messages Body]], and on the `db:semantic-probe` measurements (#302, #330).

## Context

Documents and mail are searchable text, but nothing says what each one IS. The classifier is TypeSafe's Jev (`@typesafe-ai/sdk`). Measured on tai-001 with `jev-1.13.0`: 450 calls, 0 failures, p50 408-526 ms. Jev answers over labels it is given and does not invent them. Six generic labels left 19.5% `other`; the 38-kind generic catalogue `DOCUMENT_KINDS` left 0.7% of files and 0% of mail bodies `other`, 74% at confidence >= 0.90, at \~1,000 more input tokens a call. No generative model runs in production. The owner decided a tenant's catalogue is initialised by Jev from the generic one (kinds >= 1% of a sample) and then edited by the tenant's admin; for tai-001, 25 kinds and `other`.

## Decision

* A tenant owns a catalogue, `app.document_kind` (kind, description the classifier reads, origin `initialised`/`generic`/`admin`). `other` is always in it and cannot be removed.
* Initialising is a worker run (`semantic-init`), started by the admin: sample by digest, files and mail bodies apart, ask the whole generic catalogue, keep >= 1% of either. Only the worker may read `raw.document_text.text`. It never overwrites a catalogue that has kinds.
* Edits are drafts until published. Each published catalogue is a snapshot, `app.document_kind_version`, with a `definition_hash` over a versioned canonical definition (instruction, pinned model, kinds and descriptions). A publish whose hash equals the newest makes no version. `documentKinds.list` says whether the draft differs and how many documents a publish would classify.
* A result belongs to the bytes, per tenant: `raw.document_kind` keyed tenant and `source_sha256`, with kind, confidence, all probabilities, model, hash, status (`classified`, `too-short`, `invalid-response`, `provider-error`) and reason. The worker copies the current version into `raw.document_kind_definition` because tenant dbt logins cannot read `app`. BI reads nothing in `raw`.
* Classifying is a worker run (`semantic`) per (tenant, source), like `extract`: `semantic-due` lists pairs with a digest missing a current result or failed at the provider; 500 digests a run, one call each; texts under 60 characters are `too-short`; out-of-list labels are `invalid-response`. Kestra `semantic_due` ticks every 30 minutes.
* Nothing is sent until an admin acts; without `UNDERCROFT_TYPESAFE_API_KEY` on the worker the verb says it is not configured.
* Confidence applies when read: the `security_invoker` view `raw.document_kinds` gives kind, confidence, `current`, and `accepted_kind` (NULL below 0.90 or under a replaced catalogue).
* Surfaces: `documentKinds.list` (member), `.add`, `.update`, `.remove`, `.publish`, `.initialise` (admin), audited, through the one router to web, CLI and MCP.

## Consequences

Tenants see what their documents are without writing a list. tai-001 has \~51,000 readable texts: a classification is \~51,000 calls (\~150M input tokens), about seven hours; every publish repeats it. A second provider is a second adapter. The worker needs the TypeSafe key, set in Dokploy.

## Rejected

The whole generic catalogue for every tenant (pays for 38 labels, shows kinds never held); a generative model proposing labels (not in production); a hand-written catalogue; re-classifying on every edit; results per record or per document (pays again for every copy); a threshold stored with the result.

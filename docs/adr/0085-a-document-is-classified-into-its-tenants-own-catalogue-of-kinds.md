# 85. A document is classified into its tenant's own catalogue of kinds, drawn from a generic one

- Status: Accepted
- Date: 2026-09-29
- Builds on: [ADR 0024](0024-extracted-text-is-readable-by-dbt.md) (the text it reads),
  [ADR 0084](0084-a-gmail-harvest-lands-each-messages-body.md) (mail bodies are documents too) and
  the measurements taken with `task db:semantic-probe` (#302, #330).

## Context

A tenant's documents and mail are searchable text since ADR 0024 and ADR 0084, but nothing says
what each one IS -- an invoice, a board resolution, a passport, a newsletter. That is the first
question a model asks of a document pile, and it cannot be written in SQL.

The classifier is TypeSafe's Jev (`@typesafe-ai/sdk`, already a dependency). Measured on `tai-001`
with model `jev-1.13.0`, sequentially, retries off:

- 450 calls, **0 failures**; p50 408-526 ms, p95 under 1.5 s; one call answers several questions
  for about the price of one.
- Jev answers a question over labels it is GIVEN; it does not invent them. Six generic labels left
  **19.5%** of documents `other`. A generic catalogue of 38 kinds (`DOCUMENT_KINDS`, #330) left
  **0.7%** of 300 files and **0%** of 150 mail bodies `other`, with 74% of answers at confidence
  > = 0.90 -- at the cost of about 1,000 more input tokens a call for the longer list.
- The platform has no generative model to propose labels: `UNDERCROFT_ANTHROPIC_API_KEY` is empty
  in production and is not required to run it.

The owner decided (2026-09-29): a tenant's catalogue is INITIALISED by Jev from the generic one,
keeping every kind at or above 1% of a sample, and the tenant's admin then adds, removes and edits
kinds. For `tai-001` that is 25 kinds and `other`.

## Decision

1. **A tenant owns a catalogue of kinds** (`app.document_kind`): a kind, the description the
   classifier reads, where it came from (`initialised`, `generic`, `admin`) and who last changed it.
   In `app` because a description is text a person may write, and BI has no USAGE on `app`.
   `other` is always in it and cannot be removed: without it every document is forced into a
   kind, which is a guess.
2. **Initialising is a worker run** (`semantic-init`), started by the admin: it samples the tenant's
   texts by digest -- files and mail bodies apart, as the probe does -- asks Jev the whole generic
   catalogue, and writes the kinds at or above 1% of either sample, each with the share it was seen
   at. It runs in the worker because only the worker may read `raw.document_text.text` (`pii.md`).
   It refuses to overwrite a catalogue that already has kinds.
3. **Edits are drafts until PUBLISHED.** Every published catalogue is a snapshot
   (`app.document_kind_version`) with a `definition_hash` over a versioned canonical JSON of the
   instruction, the model and every kind with its description. Publishing is what re-classifies,
   because any change to the list can change any answer; drafting several edits and publishing
   once pays for one re-classification, not one per edit. A publish whose definition hashes to
   the newest version's makes no version. `documentKinds.list` says, before a publish, whether the
   draft differs from what is published and how many readable documents it would classify.
4. **A result belongs to the BYTES, per tenant** (`raw.document_kind`, keyed tenant and
   `source_sha256`): the kind, its confidence and every kind's probability, the model, the
   `definition_hash` it answered, a status (`classified`, `too-short`, `invalid-response`,
   `provider-error`) and a reason. In `raw` beside `raw.document_text`, as a rebuildable
   projection of it: a tenant's dbt login reads it through `ops.provision_tenant` and the same
   `raw.tenant_of` row-level security; the BI role reads nothing in `raw`. Which version is
   current is copied by the worker into `raw.document_kind_definition` (a number and a hash, no
   description), because a tenant's dbt login may not read `app`.
5. **Classifying is a worker run** (`semantic`) per (tenant, source) pair, exactly as `extract` is:
   `GET /v1/runs/semantic-due` lists the pairs with a readable digest whose result is missing,
   answered an older `definition_hash`, or failed at the provider; `POST /v1/runs/semantic` reads a
   bounded batch (500 digests), one Jev call per digest, sequentially. A text under 60 characters
   is recorded `too-short` without a call (the logos OCR reads out of mail). A label the catalogue
   never offered is `invalid-response` (`judge`). A Kestra flow, `semantic_due`, ticks every 30
   minutes; a pair already running is a 409 it ignores.
6. **Nothing is sent to the provider until an admin acts.** No catalogue, or no published version,
   means no due work. No `UNDERCROFT_TYPESAFE_API_KEY` on the worker means the verb answers
   "semantic is not configured" and the due list is empty, and the boot log says which.
7. **Confidence is applied when read, not when written.** The stored result keeps every
   probability. A view, `raw.document_kinds`, gives each live document its kind, its confidence,
   whether the answer is `current`, and an `accepted_kind` that is NULL below 0.90 or under a
   replaced catalogue -- so a threshold can be moved without asking again, and a guess never
   reads as a fact. The view is `security_invoker`: run as its owner it would pass the tables'
   row-level security, and every tenant's login would read every tenant's kinds.
8. **The surfaces are the router's.** `documentKinds.list` (member), `.add`, `.update`, `.remove`,
   `.publish` and, with the worker verb, `.initialise` (admin), each audited, reach the web, the
   CLI and MCP through the one router (ADR 0044, ADR 0060). The UI follows in its own change.

## Consequences

- A tenant sees what its documents are, per kind, in Reports and in its own dbt models, without
  anyone writing a list -- and changes the list when it is wrong.
- `tai-001` holds about 51,000 readable texts. A first classification is about 51,000 calls, ~3,000
  input tokens each (~150M tokens), taking about seven hours sequentially at 500 per run every 30
  minutes. Every publish repeats it; the publish answer says so before it is confirmed.
- A second provider is a second adapter at the worker's composition root; the stored shape does not
  name Jev beyond the `model` column.
- The worker needs `UNDERCROFT_TYPESAFE_API_KEY`, set by a person in Dokploy (`deployment.md`).

## Options rejected

- **Classifying into the whole generic catalogue for every tenant.** Works (0.7% `other`) but pays
  for 38 labels on every call and shows a tenant kinds it never has.
- **A generative model proposes the labels.** No such model runs in production, and requiring one
  adds a vendor and a key for a step Jev can do from the generic list.
- **The tenant writes its catalogue by hand.** Nobody would, and a blank list classifies nothing.
- **Re-classifying on every edit.** One published version per decision is the unit that costs.
- **Results in the record or per document.** A digest is the unit the text is read at; per document
  would pay again for every copy of a forwarded attachment (4,476 documents over 2,030 digests when
  measured).
- **A threshold stored with the result.** It would have to be recomputed by asking again.

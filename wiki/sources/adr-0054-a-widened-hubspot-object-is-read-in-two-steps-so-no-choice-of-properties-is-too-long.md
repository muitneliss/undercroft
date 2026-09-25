---
title: >-
  ADR 0054: A widened HubSpot object is read in two steps, so no choice of
  properties is too long
type: source
date: 2026-09-25
tags: []
source: docs/adr/0054-a-widened-hubspot-object-is-read-in-two-steps.md
source_path: docs/adr/0054-a-widened-hubspot-object-is-read-in-two-steps.md
source_hash: 622fc73748e8deff06cd66af5653ad7f0d8dba4153a3b399254c6dadad94290c
ingested: 2026-09-25
---

# ADR 0054: A widened HubSpot object is read in two steps, so no choice of properties is too long

Accepted 2026-09-25. Supersedes three clauses of [[ADR 0052: A HubSpot scope adds to the spec's properties, and a widened read starts a new watermark]]: the save-time refusal of a choice too long for one URL (`too-many-properties`, `MAX_PROPERTY_QUERY_CHARS`, `overlongPropertyChoices`), its rejected option "POST the property list instead of sending it in the URL", and "the spec format does not grow". The floor, the optional scope, the one seam in `withChosenProperties` and the request-keyed watermark all stand. Issue #210.

**Problem.** ADR 0052 put the chosen properties in the list GET's `properties` query, so it refused any object whose choice would not fit in a URL. A portal's full list of contact properties does not fit: Select all on Contacts disabled the page's one Save, the server refused the whole selection (a valid Deals choice with it), and some contact properties could never reach the lake.

**Decision.** A widened object is listed exactly as the spec declares it, and each page is then read whole by HubSpot's batch read, `POST /crm/v3/objects/{objectType}/batch/read` with `{ inputs: [{id}], properties: [...] }` in the body. HubSpot's object API guide documents it at up to 100 records per request and says it is a POST to avoid GET's URL length limits. The list supplies ids and the cursor; the batch read supplies what is landed. It is not the search endpoint (no 10,000 cap), and each record it answers is one record HubSpot sent, in the list's shape under the same id, so nothing is assembled from two answers.

* The spec format gains an optional `batchRead` (`path`, `bodyTemplate: hubspot-batch-read`, `properties`) on a `list` request (`connectorSpec.ts`). No `chunkSize`: the endpoint's limit (100 ids) belongs to the template, and the block stays all strings for the request key's `canonicalJson` digest.
* Why the format grows despite ADR 0052: `batchRead` describes a request shape, not a scope, and the runtime executes it like `batch-from` without knowing why. The alternative, a second HubSpot reader in the worker, would re-implement pacing, retry, paging, guards and the watermark filter beside the runtime's.
* The shipped `hubspot.yaml` does not use it. `withChosenProperties` adds it (list path plus `/batch/read`, the spec's properties then the chosen ones, sorted) and returns the same entity when a choice adds nothing, so an unscoped connection sends byte-for-byte the same requests and keeps its watermarks.
* The list page is what `seen` counts and the watermark filters, so `failOnEmpty`, `failOnExactCount`, `maxRecords` and the client filter keep their meaning (`batchRead.ts`, `rereadPage`). A filtered record is not asked for at all.
* The request key digests the whole request, `batchRead` included, so a changed choice starts from no mark; so does the deploy, once, for every object ADR 0052 widened.
* Every id the list named must be answered by a record or by an `OBJECT_NOT_FOUND` error naming it (HubSpot's 207 Multi-Status). A not-found record was deleted between the calls and is not landed; nothing is lost. Any other error category, an id answered by neither, or a record nobody asked for raises a `ConnectorError`, keeping the watermark (`connectors.md`: a failure raises).
* Records land in the order the list named them.
* The length refusal is removed everywhere: the service outcome, its message in both locales, the contracts constant and function, the picker's pre-check and message, and the CLI contract paragraph.

**Consequences.** Any property of any object, Select all included, can be saved and read; one object cannot block another's save. A widened full read makes up to twice the requests (list plus batch read per page) under the same pacer. A deleted chosen property is answered by its absence; if HubSpot ever errored on it instead, the read would raise, not drop records. A record merged between the calls may come back under another id and the read raises; the next run reads the survivor.

**Rejected.** Per-object saving (unblocks Deals but leaves some contact properties unreadable for good, and adds a partial-save state); search (silent 10,000 cap); batch-reading every object including unscoped ones (doubles requests and changes every unscoped request and watermark for nothing); declaring `batchRead` in `hubspot.yaml`; failing on `OBJECT_NOT_FOUND` (a deletion at the wrong moment would fail long first reads repeatedly); filling a not-found record from the list's floor-only copy (a payload that looks complete and is not); a `chunkSize` knob (only a way to get the endpoint limit wrong, and a number breaks the digest).

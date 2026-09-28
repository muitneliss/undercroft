---
title: ADR 0071 A Record A Complete Listing No Longer Names Is Removed At Source
type: source
date: 2026-09-28
tags: []
source: >-
  docs/adr/0071-a-record-a-complete-listing-no-longer-names-is-removed-at-source.md
source_path: >-
  docs/adr/0071-a-record-a-complete-listing-no-longer-names-is-removed-at-source.md
source_hash: 7a6a462296be5dc30064d04717d99df915d86e1be3f053f4bad7cd79c99c191d
ingested: 2026-09-28
---

# ADR 0071 A Record A Complete Listing No Longer Names Is Removed At Source

# ADR 0071 A Record A Complete Listing No Longer Names Is Removed At Source

Status: Accepted, 2026-09-28. Issue #278. Builds on [[An ingest streams, and does not re-read what it already holds]] (the Drive `seenIds` trap) and ADR 0051 (a stopped run decides nothing).

## Context

HubSpot records archived, deleted or merged away stayed live in the lake, and the Raw lake's "deleted at source" count read 0 for every HubSpot stream. `raw.records.deleted_at` was counted (`summariseRecords`) and filtered by dbt, but nothing wrote it: the upsert only clears it, and the one tombstone writer, `tombstoneMissing`, is Drive's on `raw.documents`.

A HubSpot run does read the whole live list: `GET /crm/v3/objects/{type}?archived=false`, paged by record id (`after`), with a `client-filter` watermark that pages everything and only skips landing unchanged records. HubSpot: archived records sit in the recycle bin 90 days then are deleted permanently; a GDPR delete is immediate; a merge makes a new record id, both old ids leave the live list, and the survivor lists them in `hs_merged_object_ids`.

## Decision

* **`removedWhen` on a spec entity** (`connectorSpec.ts`): `absent` (a `list` that, read whole, is every live record) or `parent-removed` (a `batch-from` relation keyed by its parent's id, whose parent must be `absent`). Omitted means a record that stops appearing stays live, the right default for a filtered list or a label.
* **The runtime decides completeness** (`connector-runtime/src/listing.ts`). `readEntity` returns `ReadEnd.listed`: every id the source named, filtered or not, or `null` when the entity does not declare `absent`, a `header`/`query-param` watermark was sent (`asksSourceForLess`), `maxRecords` truncated the read, or the listing is empty. It is the generator's return value, so a read that threw or was stopped never yields one. An id enters the set before the client filter.
* **The worker settles it last** (`runPaths.ts` via `keepingEnd`, then `removals.ts`, then `rawRecords.reconcileRemovals`), after the ledger and the cursor: held rows not listed get `deleted_at = now()`, removed rows listed again are cleared (a restored record is usually unchanged and would never be re-landed). The same listing settles each `parent-removed` relation, so a removed deal's company links go with it.
* **Nothing is erased**: the row keeps its last payload and the lake keeps every version.
* **`hs_merged_object_ids`** is added to each HubSpot object's properties, so the survivor of a merge names what merged into it.

## Consequences

* The first complete run after release marks everything already deleted, stamped with that run's time (when noticed, not when deleted).
* A record deleted between list and batch read ([[ADR 0054: A widened HubSpot object is read in two steps, so no choice of properties is too long]]) is decided by the next run.
* `deleted_at` is not in the lake: a rebuilt projection is live until the next complete run decides again.
* A removed row does not point at its survivor; the pointer is in the survivor's payload.
* A link removed while its deal stays live is not detected.
* New HubSpot objects need `removedWhen: absent`; `connectorSpec.test.ts` pins it. Xero declares nothing.

## Options rejected

* `archived=true` as positive evidence: an extra paged read per object that misses permanent deletes and merges and still needs the live list for restores.
* A periodic ids-only read: the client filter already pages every live record.
* Special-casing HubSpot in the worker: a connector is configuration.
* Inferring absence for every entity: wrong for any filtered list.

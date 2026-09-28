---
title: >-
  ADR 0075 HubSpot Reads Its Commerce Objects And Names A List Its Token Cannot
  Read
type: source
date: 2026-09-28
tags: []
source: >-
  docs/adr/0075-hubspot-reads-its-commerce-objects-and-names-a-list-its-token-cannot-read.md
source_path: >-
  docs/adr/0075-hubspot-reads-its-commerce-objects-and-names-a-list-its-token-cannot-read.md
source_hash: cebbae2ea6b585d6a889cbf74c9b2dac882b3ff1c6e1cfcb7c60db5e1dcc959d
ingested: 2026-09-28
---

# ADR 0075 HubSpot Reads Its Commerce Objects And Names A List Its Token Cannot Read

# ADR 0075 HubSpot reads its commerce objects, and a list its token cannot read is named, not failed

Status: Accepted, 2026-09-28. Issue 279 (replacing 246). Extends
[[ADR 0073 A List Its Grant Cannot Read Is Named Not Failed]] with a second way a list is named
`entity_not_granted`: a pasted token refused on the list's first request. Supersedes one
consequence of [[ADR 0071 A Record A Complete Listing No Longer Names Is Removed At Source]]: a
relation no longer asks only about the parents that changed.

## Context

Up to v1.42.0 `specs/connectors/hubspot.yaml` read companies, contacts, deals and the deal-to-company
link. Analysts could not report quotes, owners, won/lost deals or a contact's second company. A
HubSpot private-app token carries scopes ticked in HubSpot and nothing records them, so a token
without the quotes scope failed the whole run at the quotes request. Verified against HubSpot's docs
and OpenAPI specs: object lists page by `after` with no 10,000 cap (only search has one); `archived`
selects archived records only, on lists and batch reads; line items name products in
`hs_product_id` and products cannot be associated; owners take `archived`; deal pipelines are unpaged
with string `metadata`; v4 association batch reads answer `associationTypes` (category, typeId,
label) and page one record's links by `after`; a missing scope is a 403 (category `MISSING_SCOPES`
from HubSpot's own client code; the scopes' context key is undocumented).

## Decision

* Twelve new entities: `quotes`, `line_items`, `products` (archived=false and archived=true),
  `owners` (both), `deal_pipelines`, and seven v4 link reads: `contact_companies`, `deal_contacts`,
  `deal_quotes`, `deal_line_items`, `quote_line_items`, `quote_contacts`, `quote_companies`. The four
  existing entities keep their requests byte for byte, so their request keys and watermarks stand.
  New lists page by `after` as a cursor. Products, owners and pipelines have no watermark.
* `request.partitions`: one list read once per set of query values, landed as one entity, its
  listing the union; a two-step batch read carries the partition's values.
* A relation asks about every id its parent's read named (`RunContext.keepIds`, `ReadEnd.named`),
  so a link read added after its parent's watermark backfills; a record whose links HubSpot pages
  is read to its last page and lands whole.
* `auth.grantRefusal: hubspot-missing-scopes`: a 403 `MISSING_SCOPES` on an entity's FIRST request
  raises `EntityNotGranted`; the worker writes ADR 0073's `entity_not_granted` with the scope and
  reads on. Relations of a refused parent are named too. Any other failure still fails the run.
  `readScope` is allowed on bearer specs and required once `grantRefusal` is declared.
* The property picker leaves out an object HubSpot refuses; the Journal tells a HubSpot reader to
  grant the scope in HubSpot rather than reconnect. `failOnExactCount: 10000` is removed.

## Consequences and rejected

Each run asks for the links of every contact and deal (one request per hundred parents per link
kind). A HubSpot token lacking core scopes now succeeds with named lists. Unverified live: the 403
scope key, whether links need both scopes, the per-record link page size, `hs_product_id` on
archived products, `isClosed` on every stage. Rejected: archived records as separate entities,
changed-only link reads with a one-off backfill, refusing the whole run, v3 associations, reading
every 403 as not granted.

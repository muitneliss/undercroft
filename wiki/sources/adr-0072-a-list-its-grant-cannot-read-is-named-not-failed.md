---
title: ADR 0072 A List Its Grant Cannot Read Is Named Not Failed
type: source
date: 2026-09-28
tags: []
source: docs/adr/0072-a-list-its-grant-cannot-read-is-named-not-failed.md
source_path: docs/adr/0072-a-list-its-grant-cannot-read-is-named-not-failed.md
source_hash: d4ba76010f41d24eca9ac08b35e96db3f77b5135011e5a20e434a8be31c9307e
ingested: 2026-09-28
---

# ADR 0072 A List Its Grant Cannot Read Is Named Not Failed

# ADR 0072 A list its grant cannot read is named in the run, not failed, and Xero asks for settings

Status: Accepted, 2026-09-28. Issues 276 and 277. Supersedes three points of
[[ADR 0069 Xero Reads Every List Its Granular Scopes Reach]]: Items under
`accounting.invoices.read`, the refusal of a whole run whose grant lacks a declared scope, and the
rejection of a per-entity scope field. Paging, filtering and `failOnEmpty` from ADR 0069 stand.

## Context

Since v1.42.0 a default Xero run failed on items with a bare `HTTP 401` after eight lists read with
the same token. Xero's OpenAPI document puts `GET /Items`, `/Accounts`, `/TrackingCategories`,
`/TaxRates` and `/Currencies` under `accounting.settings.read`, which the consent never asked for.
Issue 277 wants the four settings lists so line codes resolve. ADR 0069's rule would have refused
every existing Xero connection's runs once the new scope was added, losing twelve readable lists to
protect five.

## Decision

* The consent asks for `accounting.settings.read` (spec `auth.scopes` and `oauthProviders.ts`).
  Items moves under it; `accounts` (`AccountID`, `If-Modified-Since`), `tracking_categories`
  (`includeArchived=true`, options nested), `tax_rates` (keyed on `TaxType`) and `currencies`
  (keyed on `Code`) are added, all unpaged with `failOnEmpty: false`. Accounts and tax rates are
  read with no `where`; that an unfiltered read includes archived records is inferred from the
  OpenAPI document, not yet checked live.
* Each entity names its `readScope`, validated by the spec contract: required of every entity in an
  oauth2 spec whose consent names scopes, and one of `auth.scopes`. `oauthProviders.test.ts` pins
  each `readScope` to Xero's path-to-scope table.
* `partitionByGrant` (`apps/worker/src/services/grant.ts`) replaces `requireSpecGrant`. `openSpecRun`
  splits the chosen lists by the recorded grant before any request; each ungranted list gets an
  `entity_not_granted` warning in `ops.run_event` with its scope, worded by the Journal (Vietnamese
  first) as "reconnect to grant" the scope, and shown as not granted in the flow. The rest are read
  and the run is not failed for the skip. No `ops.run_refusal` or zero-count `ops.run_entity` row.
* A run left with no readable list fails with `GrantTooNarrow` naming the scopes. An empty recorded
  grant is still not judged.

## Consequences

Old connections keep their schedule, read twelve lists and close succeeded, naming the five
settings lists; after a reconnect all seventeen are read. Their cards read reconnect (no Run now),
with the general lapsed sentence, which overstates a partly working grant. A future consent scope
costs nothing at deploy.

## Rejected

Keeping ADR 0069's whole-run refusal; dropping items; recording a skip as a refusal or a zero
count; the scope table only in a test; a special rule for "new" scopes.

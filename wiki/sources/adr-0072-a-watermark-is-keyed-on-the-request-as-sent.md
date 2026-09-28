---
title: ADR 0072 A Watermark Is Keyed on the Request as Sent
type: source
date: 2026-09-28
tags: []
source: docs/adr/0072-a-watermark-is-keyed-on-the-request-as-sent.md
source_path: docs/adr/0072-a-watermark-is-keyed-on-the-request-as-sent.md
source_hash: fe3c17a894211ad313d17c4686722732e85120cda17d6fed95e209d6e08d572c
ingested: 2026-09-28
---

# ADR 0072 A Watermark Is Keyed on the Request as Sent

# ADR 0072 A Watermark Is Keyed on the Request as Sent, Declared or Scoped

Status: Accepted, 2026-09-28. Supersedes, in part, the "`''` for an entity read exactly as its spec
declares it" decision of [[ADR 0052 A HubSpot Scope Adds to the Spec's Properties and a Widened Read Starts a New Watermark]].
The rest of ADR 0052 stands, as does [[ADR 0034 The Watermark Is a Table Not a Max]].

## Context

Xero rounds a line's `UnitAmount` (an item's `UnitPrice`) to 2 decimals unless the request sends
`unitdp=4`; `xero.yaml` never did, so `0.2248` landed as `0.22` and some line amounts fell below the
subtotal (#280). Adding the parameter fixes new reads only: incremental lists ask only for what
changed since the watermark, so an unedited bill keeps the rounded price. ADR 0052 keyed a watermark
on its request (`raw.sync_cursor.request_key`) but gave the declared request `''`, which made a
spec edit invisible to the cursor.

## Decision

* **`requestKey(spec, entity)`** in `packages/connector-runtime/src/incremental.ts`: SHA-256 over the
  canonical JSON of the base URL, the entity's `request` and `defaults.headers`, the same for a
  declared or a scoped entity. A changed request finds no mark and reads in full once; an unchanged
  one keeps its mark. The worker stores the key opaquely; `specRun.ts` loses `requestKeyOf` and
  `EntityRead`.
* Left out: pagination, pacing, guards, envelope/id paths, the `incremental` block (format already
  keys the cursor), and per-run values (token, account header).
* `xero.yaml` sends `unitdp: "4"` on `/Invoices`, `/CreditNotes`, `/Overpayments`, `/Prepayments`,
  `/Items`, the lists whose endpoint declares it in Xero's OpenAPI. Not on `/Quotes`,
  `/PurchaseOrders`, `/RepeatingInvoices`.
* No migration: a legacy `''` row matches no digest, reads in full once, and is overwritten.

## Consequences

The first run after release re-reads every incremental stream once: Xero documents re-land at 4
decimals without reconnecting (changed bytes as a new version, identical ones `unchanged`); HubSpot's
`client-filter` streams page in full anyway, so only landing work is added. Future spec edits to a
request re-read that list by themselves; a runtime change that alters answers (like #268) still
needs a one-off such as `320_xero_reread.sql`. Canonical JSON means reformatting a spec re-reads
nothing.

## Rejected

A one-off migration forgetting Xero's cursors (fixes once, leaves the gap); a hand-bumped per-entity
`revision` (grows the format, fails silently when forgotten); keeping `''` for the declared request
(a legacy row cannot be told apart); including the `pagination` block (walking pages does not change
what a record is answered as).

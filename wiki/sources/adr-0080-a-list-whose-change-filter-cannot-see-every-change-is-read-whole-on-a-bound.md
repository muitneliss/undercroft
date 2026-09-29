---
title: >-
  ADR 0080 A List Whose Change Filter Cannot See Every Change Is Read Whole on a
  Bound
type: source
date: 2026-09-29
tags: []
source: >-
  docs/adr/0080-a-list-whose-change-filter-cannot-see-every-change-is-read-whole-on-a-bound.md
source_path: >-
  docs/adr/0080-a-list-whose-change-filter-cannot-see-every-change-is-read-whole-on-a-bound.md
source_hash: 83efb059327b036b9c1d24e0c84939df8ec3617e434e8270a0c0af769a45a7a2
ingested: 2026-09-29
---

# ADR 0080 A List Whose Change Filter Cannot See Every Change Is Read Whole on a Bound

# ADR 0080 A list whose change filter cannot see every change is read whole on a bound

Status: Accepted, 2026-09-29. Issue 314. Extends [[ADR 0034 The Watermark Is a Table Not a Max]] and [[ADR 0072 A Watermark Is Keyed on the Request as Sent]]; both stand, and this adds a third reason to refuse a watermark: its age.

## Context

Every paged Xero list reads incrementally on `If-Modified-Since` after its first run. Xero documents that some edits do not move `UpdatedDateUTC` and so are never returned: `DueDate` or `SentToContact` on a partially paid transaction, and a contact's `Balances`, `IsSupplier` and `IsCustomer`. The list says "such as"; Fivetran documents a line's `AccountCode` too. A due date moved on a partially paid invoice stayed stale in the lake while every run reported success. Fivetran re-reads Xero contacts daily and uses webhooks for invoices; Airbyte and Singer's tap-xero miss the same edits.

## Decision

* An incremental entity may declare `wholeReadAfterHours`. A run reads it whole, sending no watermark, when the run that last read it whole started that many hours before this one did, less one scheduler tick. Every Xero list read on `If-Modified-Since` declares 24.
* The time is a run's start, kept in `raw.sync_cursor.whole_read_at` and recorded by any read that sent no watermark (first read, changed request, or the bound). The cadence measures gaps between run starts too.
* One tick short, because a cron can start a few minutes less than a day after the last run; measured exactly, a daily cron would read whole only every second day.
* The refusal is the same `null` `readSyncCursor` already returns. A whole read lands unedited records as unchanged and edited ones as changed.
* Bound: a value Xero changes without moving `UpdatedDateUTC` reaches the lake within 24 hours plus one run interval: at most 25 hours hourly, 30 every six hours, one day on daily (which reads whole on every run).

## Consequences

Existing cursors have no whole read on record, so the first run after deploy reads each Xero list whole once, repairing stale values without a reconnect. A whole read costs one request per 100 records plus one, once a day, against 5,000 a day. An organisation past Xero's 100,000-document refusal already fails its first read and would fail the daily read too. Contact `Balances` stays Xero's own base-currency snapshot; models should derive outstanding and overdue amounts from invoices.

## Rejected

Xero webhooks (a new public endpoint and a second way in, disabled after 24 hours of failures, so no bound alone; may come later on top); re-reading open invoices by `Statuses=AUTHORISED` each run (covers only invoices, not contacts, account codes or unlisted edits); a bound counted in runs (cadences vary from five minutes to paused); `where=UpdatedDateUTC>=` (same field, same blind spot, unoptimised).

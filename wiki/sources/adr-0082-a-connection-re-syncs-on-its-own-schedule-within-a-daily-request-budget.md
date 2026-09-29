---
title: >-
  ADR 0082 A Connection Re-Syncs on Its Own Schedule Within a Daily Request
  Budget
type: source
date: 2026-09-29
tags: []
source: >-
  docs/adr/0082-a-connection-re-syncs-on-its-own-schedule-within-a-daily-request-budget.md
source_path: >-
  docs/adr/0082-a-connection-re-syncs-on-its-own-schedule-within-a-daily-request-budget.md
source_hash: 59651a75ab85730b1ac241638d7c32a71f0c857e1f8df69ca9509d90a0e08ffc
ingested: 2026-09-29
---

# ADR 0082 A Connection Re-Syncs on Its Own Schedule Within a Daily Request Budget

# ADR 0082 A connection re-syncs on its own schedule, within a daily request budget

Status: Accepted, 2026-09-29. Supersedes in part [[ADR 0080 A List Whose Change Filter Cannot See Every Change Is Read Whole on a Bound]]: its spec field `incremental.wholeReadAfterHours` and the 24 hours in `xero.yaml` are removed; its reasoning (Xero's change filter misses edits), `raw.sync_cursor.whole_read_at` as a run's start, and the preset tick slack stand.

## Context

How often to re-read a customer's lists whole is the customer's choice, and a large Xero organisation's whole read spends much of Xero's 5,000 requests a day per organisation. The runtime's `requestsPerDay` was in-process per entity and forgotten per run, so a whole read meeting Xero's limit hit 429s and failed the run, starving the incremental reads.

## Decision

* `ops.connection.resync_cadence` / `resync_cron` mirror `cadence` / `cron` (same presets, custom cron in Singapore time, same CHECKs, same `cadenceSetting`). Default `paused`: re-sync is opt-in. Set on the Sources card beside the sync schedule, or via `connections.setResync` (CLI `connections set-resync`, MCP `connections_setResync`). A source reading no list through a server-side change filter (HubSpot's client filter) is refused `not-resyncable` and shows no re-sync row.
* `wholeReadDue` in `@undercroft/contracts` applies the cadence rule to the start of the run that last read a list whole: presets get one scheduler tick of slack, a cron none; never-read lists are always due, paused never. A re-sync rides on sync runs only.
* `defaults.wholeReadBudget` in the spec: Xero gives whole reads (first read, changed request, re-sync) 4,000 of 5,000 requests a day, keeping 1,000 in reserve; kept beside `rateLimit`, validated to leave a reserve.
* The trusted count is the provider's `X-DayLimit-Remaining` (covers retries, Xero's unpublished window, other apps); fallback is this run's own whole-read requests. One `DayBudget` per run in the worker.
* Runtime `RunContext.budget` (`admit` before each page/chunk, `spent` with each response's headers); a refusal ends the read as truncated with `ReadEnd.exhausted`, no guards, `listed: null`.
* Per list: whole read under budget when unwatermarked or due and room exists; incremental from the reserve when due but no room; wait (no request, journal `whole_read_waiting`, counted as read) when unwatermarked and no room. A budget-cut whole read saves no cursor (still due next run), journals `whole_read_paused`, and the run closes ok (no alert). Lists restart from their start rather than a page: at 500 per page one list needs \~2M records to exceed a day, beyond Xero's 100k-document refusal.
* `raw.sync_cursor.whole_read_requests` records each completed whole read's cost; the card sums them over the connection's lists, divides by the budget and warns "a full re-sync takes about N days" when N > 1, and shows the stalest list's last whole read. The app gets a column-scoped SELECT on five cursor columns (not the watermark), in `380_connection_resync.sql`.
* Xero lists page at 500 (half of Xero's max 1,000), which also forces one whole read per paged list after deploy (ADR 0072).

## Consequences

After deploy every Xero re-sync is off; each paged list is read whole once, then nothing is re-read on a schedule until an admin opts in, and #314's invisible edits stay stale where it stays off. A new large organisation's first read finishes over several runs instead of failing on 429. A budget-limited run closes ok with a journal warning. The card's estimate stays empty until every list has completed a whole read since this change. Xero's 100,000-document refusal is untouched and separate work (#322).

## Rejected

A spec interval with a per-connection override (two owners); resuming a cut read by page or stamp (page shifts, and Xero's order is unreliable per ADR 0034); counting our own requests across runs (misses retries, other apps and Xero's window); a bound counted in runs; defaulting Xero's re-sync to daily (spends requests nobody chose to spend).

---
title: ADR 0032 A Progress Line Is a Gauge Not an Entry
type: source
date: 2026-09-21
tags: []
source: docs/adr/0032-a-progress-line-is-a-gauge-not-an-entry.md
source_path: docs/adr/0032-a-progress-line-is-a-gauge-not-an-entry.md
source_hash: 64f8b88b6ff7b0dee7e36ea3891dab433bebf9391042fdabc73750992a0b9ddc
ingested: 2026-09-21
---

# ADR 0032 A Progress Line Is a Gauge Not an Entry

# ADR 0032 A Progress Line Is a Gauge, Not an Entry

## Decision

`ops.run_event` holds two kinds of line, bounded differently because they are different things.

A **milestone** — `run_opened`, `entity_started`, `work_listed`, `entity_done`, `run_closed` — is
a thing that happened at an instant. It is appended, never rewritten, and a run is capped at 200
of them, exactly as `160_run_events.sql` has always said.

A **progress line** — `records_read`, `documents_read`, everything written through
`RunJournal.progress` — is a reading of a dial. The next reading replaces it rather than adding to
it. So it keeps **one row per `(run_id, event, entity)`**, carried by a `live` column and a partial
unique index, and a new reading is an `INSERT … ON CONFLICT DO UPDATE` that rewrites `at` and
`detail` in place. The worker is granted `UPDATE (at, detail)` and nothing else, so what an event
*is* — its level, its name, the entity it concerns — stays unwritable once recorded.

Because such a line cannot accumulate, it is **exempt from the cap**. It is also not rendered as a
line: the browser reads `live` and draws the reading as a gauge above the ledger rather than as one
more entry inside it.

No backfill. Every row already in the table stays `live = false` and reads exactly as recorded.

## Why

A Gmail ingest over 7,786 messages runs for hours and wrote a progress line every couple of
seconds. The cap counted those lines, so roughly seven minutes in the run wrote one
`events_truncated` warning and refused every reading after it. For the remaining three hours the
Journal showed a frozen counter, a frozen flow diagram (both derive from those events,
`runFlowEntities.ts`), and a feed whose last line was already stale.

The second defect had the same cause from the other end. Every admitted reading was its own row in
the feed table, so one leaf carried roughly 180 printings of one sentence — pushing the counts, the
refusals and the dbt steps off the bottom of the page, and announcing a new line to a screen reader
every two seconds through the table's `aria-live`.

Both are the same mistake: filing a reading as if it were an occurrence. The coalescing interval
also stops being a trade against the size of the table, and drops from 2s to 1s in the same change.

## Options rejected

* **Raise the cap and keep appending.** A three-hour run would write thousands of rows per entity,
  and `eventsFor` returns the newest 300 — so a run's own progress would evict its opening
  milestones.
* **Prune old progress rows.** Bounded, but it deletes rows that were recorded, and would have to
  be reported to be honest. Superseding never creates the row it would later remove.
* **Fold in the browser only.** Fixes the long leaf and not the freeze. It shipped as *part* of the
  change: the browser folds a historical run's progress rows into one gauge, so a run recorded
  before this ADR reads correctly without its rows being touched.

## Consequences

* `ops.run_event` is no longer strictly append-only, and 160's sentence carries a pointer to the one
  exception — narrow by construction: one column, set by one call path, under a column-scoped grant.
* A gauge row keeps its `id`, so it holds the place in the feed where it first appeared. Its `at`
  moves, which is exactly why the browser must not print it as a chronological line, and does not.
* `recordEvents` de-duplicates live lines within a flush: `ON CONFLICT DO UPDATE` refuses a source
  that offers the same key twice, and a flush spanning two intervals offers that.
* The `events_truncated` warning should become rare rather than routine. If it is still common on
  ingests, the remaining cause is milestones, and the cap is what to argue about then.

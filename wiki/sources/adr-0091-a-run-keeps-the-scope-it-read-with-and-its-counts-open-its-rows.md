---
title: ADR 0091 A Run Keeps the Scope It Read With and Its Counts Open Its Rows
type: source
date: 2026-09-30
tags: []
source: >-
  docs/adr/0091-a-run-keeps-the-scope-it-read-with-and-its-counts-open-its-rows.md
source_path: >-
  docs/adr/0091-a-run-keeps-the-scope-it-read-with-and-its-counts-open-its-rows.md
source_hash: ff471c8bd9211cf8365781066601c8bdb184fc9323718f1184646f9cf8104492
ingested: 2026-09-30
---

# ADR 0091 A Run Keeps the Scope It Read With and Its Counts Open Its Rows

# ADR 0091 A run keeps the scope it read with, and its counts open the rows it wrote

Status: Accepted, 2026-09-30. Builds on [[ADR 0039 A Count Has a Route to Its Constituents]], [[ADR 0043 A Second Mailbox Is a Second Source]], [[ADR 0071 A Record A Complete Listing No Longer Names Is Removed At Source]] and [[ADR 0078 A Drive Walk Lands the Folders It Lists]]. Refs #346 and the operator path in [[Design: Operator and reader paths]].

## Context

An admin checking one account walks Sources, Journal, Raw lake. The scope a run read with was not kept (the selection in `app.connection_detail` is overwritten by a save), a run's created and changed counts led nowhere, and the Journal could not be narrowed to one account. A raw row names only the run that last wrote it (`run_id` is rewritten only when content changes), so "rows with this run id" is not the run's whole output.

## Decision

* **The run records its scope as it reads it**, in `app.run_scope` (migration `440_run_scope.sql`). The collectors (`google/collect.ts`, `specRun.ts`) call `scopeForRun`: the first call copies the connection's selection into the run's row, later calls return the row, so the scope shown IS the scope used. In `app`, not on `ops.run`, because BI reads `ops.run` and the selection carries names a person wrote. The worker may insert and read, never update.
* `runs.get` returns `scope` in the card's summary shape, or `null` for a run that recorded none; the leaf prints an em dash, never today's scope.
* **`lake.records` / `lake.documents` take `runId`** (admin gate unchanged) and answer `ofRun`: `wrote` (the run's created + changed from `ops.run_entity`), `current` (rows still naming it), `rewritten` (the difference). `null` when it cannot be subtracted honestly: another source, still running, no count for the stream, or more rows than counted. An admin's counts link there; a member or viewer sees plain figures.
* **`runs.list` takes `source`**, matched as one account; a source card opens the filtered Journal, filter in the address.
* **Saving a scope states what the next read does to held records**: Drive marks what the choice no longer reaches deleted at source on its next complete read; Gmail leaves held messages live. Nothing implies erasure.

## Consequences

One `app.run_scope` row per ingest run; a NULL selection means "no scope chosen", distinct from no row. A scoped kind with nothing usable recorded shows an em dash rather than "the whole mailbox". `rewritten` is exact when the run counted each record once; where `current` exceeds `wrote` it is withheld. The run-id filter has no index yet.

## Rejected

A scope column on `ops.run` (BI exposure); snapshotting at `openRun` (a run waits for its turn, ADR 0088, and a save in that wait would mislabel it); estimating rewrites from later runs' counts; NOT\_FOUND for a foreign run id on `lake.records` (an empty page confirms nothing).

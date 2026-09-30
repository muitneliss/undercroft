---
title: What an ingest run counts
type: source
date: 2026-09-30
tags: []
source: docs/reference/run-counts.md
source_path: docs/reference/run-counts.md
source_hash: 0d2d139fa2b3db3334100273edfbd8982707ce60b86b8667a9404daaa4da885c
ingested: 2026-09-30
---

# What an ingest run counts

# What an ingest run counts

The reference page for the five per-entity numbers an ingest run reports, which the Journal's "By entity" table and `runs get` (CLI and MCP) both read from `ops.run_entity`.

**The columns.** Landed (`landed`) is every record this run read that reached the raw lake. New (`created`) is a record the lake had never held; Changed (`changed`) a new version of one it held; Unchanged (`unchanged`) a record identical to the newest stored version, for which nothing is written. Refused (`refused`) is listed with its reason and is not part of Landed.

**The sum.** Landed = New + Changed + Unchanged for every entity of every run, including a run stopped partway. A run that could not record its counts at all (killed, or cut off by a shutdown) shows zeroes that are not a count, and says so.

**Where they are decided.** Per record, at the lake write in `apps/worker/src/services/land.ts`. The projection into `raw.records` runs afterwards and decides none of them. Runs recorded before the fix for issue #284 took the split from the projection, which never saw an identical re-read, so on those runs Unchanged is short; their rows are not rewritten.

**Coarser in two places.** Documents are their own entity and count a changed document as New (Changed is always 0). The lake REST API's published response keeps `created` meaning "stored as a new version", first or not.

**Held records read again.** A Gmail run's `messages` entity carries `reread` with `records` (held messages read again because they carry an attachment the current choice allows and no earlier read landed) and `documents` (attachments that reading stored for the first time, also counted in `documents`). It is `null` on every other entity, on Drive and spec runs, and on runs before [[ADR 0076 A Harvest Records What It Left Behind]]; a Gmail run that re-read nothing says 0.

**Drive folders.** A Drive run also reports a `folders` entity: the folders its walk listed, each a record of its id and the folder that listed it, landed again only when that changed, so an unchanged tree counts nothing. `files` never counts a folder. A file whose bytes are held but whose record changed (it moved) counts as Changed on `files` and adds nothing to `documents`. [[ADR 0078 A Drive Walk Lands the Folders It Lists]].

**From a count to its records.** For an admin, New and Changed link to the Raw lake narrowed to the run (`?run=`; `lake records --run-id`, `lake documents --run-id` for `documents`). A member or viewer sees plain figures. A raw record names only the run that last wrote it, so the page lists what no later run rewrote and answers `ofRun`: `wrote` (New + Changed), `current` (still naming the run), `rewritten` (the difference) — `null` when it cannot be subtracted honestly (still running, no count for the stream, more rows than counted). [[ADR 0091 A Run Keeps the Scope It Read With and Its Counts Open Its Rows]].

**Scope and account.** A run records the scope it read with as it reads it; the run detail and `runs get` show it as `scope`, and an older run shows an em dash, never today's scope. A source card's runs link opens the Journal filtered to that account (`?source=`; `runs list --source`).

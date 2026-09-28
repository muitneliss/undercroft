---
title: What an ingest run counts
type: source
date: 2026-09-28
tags: []
source: docs/reference/run-counts.md
source_path: docs/reference/run-counts.md
source_hash: 40d45d79bf9bb6771657a802c2d8f5af30f58398562d3917794d77a6001735f8
ingested: 2026-09-28
---

# What an ingest run counts

# What an ingest run counts

The reference page for the five per-entity numbers an ingest run reports, which the Journal's "By entity" table and `runs get` (CLI and MCP) both read from `ops.run_entity`.

**The columns.** Landed (`landed`) is every record this run read that reached the raw lake. New (`created`) is a record the lake had never held; Changed (`changed`) a new version of one it held; Unchanged (`unchanged`) a record identical to the newest stored version, for which nothing is written. Refused (`refused`) is listed with its reason and is not part of Landed.

**The sum.** Landed = New + Changed + Unchanged for every entity of every run, including a run stopped partway. A run that could not record its counts at all (killed, or cut off by a shutdown) shows zeroes that are not a count, and says so.

**Where they are decided.** Per record, at the lake write in `apps/worker/src/services/land.ts`, from `LakeStore.put`'s `previousSha256`. The projection into `raw.records` runs afterwards and decides none of them. Runs recorded before the fix for issue #284 took the split from the projection, which never saw an identical re-read, so on those runs Unchanged is short; their rows are not rewritten.

**Coarser in two places.** Documents are their own entity and count a changed document as New (Changed is always 0). The lake REST API's published response keeps `created` meaning "stored as a new version", first or not.

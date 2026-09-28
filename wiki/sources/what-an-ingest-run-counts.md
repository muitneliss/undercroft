---
title: What an ingest run counts
type: source
date: 2026-09-28
tags: []
source: docs/reference/run-counts.md
source_path: docs/reference/run-counts.md
source_hash: e2945c6e0f616c2c675f5661d53f0a75eb0c3e0c8e12ca048c1f4df161838417
ingested: 2026-09-28
---

# What an ingest run counts

# What an ingest run counts

The reference page for the five per-entity numbers an ingest run reports, which the Journal's "By entity" table and `runs get` (CLI and MCP) both read from `ops.run_entity`.

**The columns.** Landed (`landed`) is every record this run read that reached the raw lake. New (`created`) is a record the lake had never held; Changed (`changed`) a new version of one it held; Unchanged (`unchanged`) a record identical to the newest stored version, for which nothing is written. Refused (`refused`) is listed with its reason and is not part of Landed.

**The sum.** Landed = New + Changed + Unchanged for every entity of every run, including a run stopped partway. A run that could not record its counts at all (killed, or cut off by a shutdown) shows zeroes that are not a count, and says so.

**Where they are decided.** Per record, at the lake write in `apps/worker/src/services/land.ts`, from `LakeStore.put`'s `previousSha256`. The projection into `raw.records` runs afterwards and decides none of them. Runs recorded before the fix for issue #284 took the split from the projection, which never saw an identical re-read, so on those runs Unchanged is short; their rows are not rewritten.

**Coarser in two places.** Documents are their own entity and count a changed document as New (Changed is always 0). The lake REST API's published response keeps `created` meaning "stored as a new version", first or not.

**Held records read again.** A Gmail run's `messages` entity carries `reread` with `records` (held messages read again because they carry an attachment the current choice allows and no earlier read landed) and `documents` (attachments that reading stored for the first time, also counted in `documents`). It is `null` on every other entity, on Drive and spec runs, and on runs before [[ADR 0076 A Harvest Records What It Left Behind]]; a Gmail run that re-read nothing says 0.

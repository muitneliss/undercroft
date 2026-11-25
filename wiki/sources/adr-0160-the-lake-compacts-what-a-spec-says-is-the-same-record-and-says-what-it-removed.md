---
title: >-
  ADR 0160 The Lake Compacts What a Spec Says Is the Same Record, and Says What
  It Removed
type: source
date: 2026-11-25
tags: []
source: docs/adr/0160-the-lake-compacts-what-a-spec-says-is-the-same-record.md
source_path: docs/adr/0160-the-lake-compacts-what-a-spec-says-is-the-same-record.md
source_hash: 3167ebdafff8abf1ccf9dc80f3a7d533694f6e74bfa160aac91d4db31ed97311
ingested: 2026-11-25
---

# ADR 0160 The Lake Compacts What a Spec Says Is the Same Record, and Says What It Removed

HubSpot's v4 association reads landed a new lake version every time HubSpot shuffled a set until [[ADR 0158 A Spec Names the Arrays That Are Sets, and the Runtime Lands Them in One Order]] stopped it; the history stayed: on one tenant `contact_companies` holds about 6,100 records and 190,000 superseded versions (A, B, A, B), `associations` about 15,000 and `quote_companies` about 9,000. Each is a manifest and a journal pointer, and MinIO's per-object overhead puts `records/` at 7.1 GB and `_journal/` at 6.1 GB on disk for 422 MB and 313 MB of content, so removing about 215,000 frees roughly 4-5 GB.

**Decision.** Equivalence is the spec's own declaration: two observations are the same record exactly when `canonicalPayload(parseLossless(bytes), entity.unorderedArrays)` agrees, so compaction removes only what ADR 0158 would have reported `unchanged`; an entity declaring nothing is never considered, and bytes that do not parse equal nothing. An observation is removed only when its canonical text equals that of the one kept before it, so the sequence of distinct payloads survives at the stamps each first appeared; the first observation and the last one considered (the newest, once the loader has passed everything) are always kept. The journal pointer is deleted before the manifest, so a full replay never meets a pointer to nothing. Only stamps at or before `raw.load_cursor.last_stamp` are considered, and a stream whose tenant and source have any run `running` is skipped, because overlapping loader passes may hold a journal listing from before the cursor moved; the cursor is read first, so a run starting later reads nothing removed. `LakeStore.planCompaction` decides per key, `applyCompaction` re-lists and acts only if the considered stamps are unchanged; each stream's plan is written to the lake under the new reserved prefix `_reports/lake-compaction/` before anything is deleted, and a `done` report after, so an interrupted run has named what it set out to remove and a re-run removes the rest. A dry run is the default. The lake stays ignorant of specs (the caller injects a canonicaliser); `services/lakeCompaction.ts` composes the pieces and `task db:lake-compact` runs it from the operator's machine through SSH tunnels, as the worker's roles. Blobs are not collected: the flip-flop reused two small blobs per record, still referenced, and a collection needs a scan of every manifest.

**Consequences.** Replays read far fewer entries; `_reports/` is a third reserved prefix; observations after the cursor, and the last before it, wait for a later run; `prune` still leaves journal pointers behind, harmless while retention is unbounded.

**Rejected.** A worker verb behind a manual Kestra flow (outlives the request timeout, gives Kestra a delete-from-raw flow); a tRPC procedure (becomes an MCP and assistant tool); comparing digests (the problem itself); keeping only the newest (loses real changes); rewriting kept observations canonically (an overwrite); reporting in `ops.run` (200-event cap, a projection); a time margin instead of the run check (bounds an observation's age, not a listing's).

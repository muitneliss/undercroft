---
title: ADR 0078 A Drive Walk Lands the Folders It Lists
type: source
date: 2026-09-28
tags: []
source: >-
  docs/adr/0078-a-drive-walk-lands-the-folders-it-lists-and-a-moved-file-without-its-bytes.md
source_path: >-
  docs/adr/0078-a-drive-walk-lands-the-folders-it-lists-and-a-moved-file-without-its-bytes.md
source_hash: fdbb1d57e18a17b4c0867d5fb7199340c03cf90b8860e90fdc65b078a723faf2
ingested: 2026-09-28
---

# ADR 0078 A Drive Walk Lands the Folders It Lists

# ADR 0078 A Drive walk lands the folders it lists, and a moved file lands again without its bytes

Status: Accepted, 2026-09-28. Issue #305. Supersedes, in part, the Drive skip in [[An ingest streams, and does not re-read what it already holds]] (ADR 0033): `modifiedTime` now decides whether a file's BYTES are fetched, and whether its RECORD lands is decided by whether the record changed. Extends [[ADR 0071 A Record A Complete Listing No Longer Names Is Removed At Source]]: a finished Drive walk is a complete listing.

## Context

A team derives client and status from where a client folder sits in Drive (office → status → client → sub-folders) and drags a client folder between status folders. A dbt model could not resolve it: folders were walked but never landed, a file carried only its direct parent, a moved file with an unchanged `modifiedTime` was skipped record and bytes together, and `tombstoneMissing` marked only `raw.documents`. Fivetran, Airbyte and dlt key files on name paths and track neither moves nor removals; Graph, Box and Notion give each item its immediate parent, and Graph's delta docs say to track by id because a moved folder does not return its descendants.

## Decision

The collector describes the tree; a model resolves it with `WITH RECURSIVE`, which the model checker admits.

* **Folders land as `folders` records**, payload `{id, parents}`: no name ([[ADR 0015 A First-Party Collector for Byte Sources]]), no `modifiedTime`. A picked folder has `parents: []`; any other names the folder whose listing found it, inside the pick by construction, never Drive's own `parents`. A folder both picked and reached through another pick keeps the listing's parent. `listMatchingIn` returns the folders it listed as its generator return value; they are landed after the files, once every pick is walked.
* **Bytes and record are two questions.** `knownRecords` (modifiedTime plus the harvest mark) decides the download. For a file whose bytes are held, the collector hashes the record it would land with the lake's `sha256Hex` and compares with `raw.records.content_sha256` via `storedDigests` (a repo function that knows no source); equal is skipped, different lands the record alone (`HarvestItem.recordOnly`), leaving the mark untouched. Folders ask only the record question. Nothing compares `parents`; any change to the record is one.
* **Removals** go through `reconcileRemovals` for `files` and `folders`, from `HarvestSummary.listings`; the `files` listing also drives `tombstoneMissing`. A stopped walk settles nothing.
* Location is read from `raw.records`; `raw.documents.metadata.parents` is where a file was when its bytes landed. No macro ships; the model-builder skill carries the recursive example.

## Consequences and cost

Dragging a client folder lands one folder version and downloads nothing. A single moved file lands its record, and its bytes only if Drive moved `modifiedTime`. A file or folder leaving the pick is marked removed at the next finished run and restored if it returns. `folders` is a new stream with its own `ops.run_entity` row. The first run after this creates a record per folder and marks removed file records whose files already left. Steady state: two Postgres round trips per 200 files instead of one, one per 200 folders, no new Drive request.

## Rejected

Paths computed by the collector (stale on every ancestor move); Drive's Changes API (its own cursor machinery, undocumented descendant behaviour, still needs folder records); landing every record and letting the lake decide (an object-store lookup per file per run); comparing `parents` in `drive.ts`; a Drive-only folder tombstone; folder names for models; a dbt macro for ancestry.

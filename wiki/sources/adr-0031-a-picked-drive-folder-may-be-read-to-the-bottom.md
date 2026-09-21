---
title: ADR 0031 A Picked Drive Folder May Be Read to the Bottom
type: source
date: 2026-09-21
tags: []
source: docs/adr/0031-a-picked-folder-may-be-read-to-the-bottom.md
source_path: docs/adr/0031-a-picked-folder-may-be-read-to-the-bottom.md
source_hash: 4555100a4ae21a2aff067f086a8c91c74b5647bdf6a4ded05b178f4e41c7fc9f
ingested: 2026-09-21
---

# ADR 0031 A Picked Drive Folder May Be Read to the Bottom

# ADR 0031 A Picked Drive Folder May Be Read to the Bottom

## Decision

**A Drive selection carries `recurse`, and the admin sets it.** False lists a picked folder's
children and stops, which is what descent had always done; true walks the whole tree beneath it.
The scope picker offers the choice and the connection card reads it back.

**The default is `false`, and that is the load-bearing half.** `DriveScope.recurse` is
`z.boolean().default(false)` in `packages/contracts/src/connectionScope.ts`, so every selection
recorded before the field existed — none of which carries the key — parses to `false` and keeps
landing exactly what it landed before. The same idiom `fileTypes` used when it arrived defaulting
to PDF-only.

Three things fall out of the walk and are part of the decision:

* **A folder is a container, never a document.** `driveListing.ts` partitions each page by Drive's
  folder MIME type. This closed a defect that predated recursion: with `fileTypes` empty ("every
  type") a sub-folder came back in the listing and was landed as a zero-byte document whose whole
  content was its name.
* **The walk is finite by construction**, through a `visited` set of folder ids — a shortcut, or a
  folder reachable down two branches, is listed once rather than forever.
* **The refusal stays at the pick.** A picked folder whose whole tree matched nothing records one
  `NOTHING_MATCHED`, not one per branch.

The listing moved to `apps/worker/src/services/google/driveListing.ts` in the same change:
`drive.ts` decides what to land and no longer knows Drive's query dialect, its paging, or that a
listing returns containers at all.

## Why

**The one-level rule answered the right hazard the wrong way.** It lived in a docstring, a test
and the product's own copy ("Only files directly inside a chosen folder are read. Sub-folders are
not"), on the reasoning that a recursive walk can reach folders the admin never saw in the Picker.
The hazard is real; the remedy left an admin who wanted a folder synced picking its files one at a
time. A consent boundary is kept by asking and recording the answer, not by refusing to ask.

**Silently widening a recorded consent is the one thing this must not do.** Recursing by default
would, on deploy, make every Drive connection in the estate read more than its admin agreed to,
with nothing in the UI changed — rule 2 broken by the platform rather than by a value.

**What is read is said while it is chosen.** The standing note became a line beneath the tick that
changes with it (`role="status"`), the card tells `scope.driveFolders` from `scope.driveFoldersDeep`,
and a run that descended says so through `journal.event.picksListedDeep`, which carries `listed`
beside `folders`.

## The open question, and how it fails

Whether `drive.file` cascades access from a picked folder to a **nested** folder is not something
Google's documentation states either way; a picked folder's direct children are demonstrably
readable, and the nested case is not. It is deliberately not guessed at. A listing Google refuses
raises through `api.getJson` as a `ConnectorError` carrying the reason and how many records were
seen, so the first recursive run says so plainly rather than landing a subset of a customer's
folder and calling itself green. If nested listings turn out to be refused, the answer is a scope
decision recorded as a new ADR, not a quiet skip.

## Options rejected

**Always recursive, no toggle** — simplest, and it silently widens every consent already recorded.
**Opt-in but defaulted on for saved scopes** — the same widening with an escape hatch for a
decision the admin never made. **Moving to `drive.readonly`** — it would settle the nested question
outright, at the price of a Google *restricted* scope: an annual CASA assessment for the whole
product and a credential that can read a customer's entire Drive rather than what they picked.

## Consequences

`scopePicker.directChildrenOnly` is gone from both catalogues, replaced by `includeSubFolders`,
`willReadOneLevel` and `willReadDeep`. `ConnectionCardView.config` carries the Drive picks as
`{ id, name, kind }` in place of `folderIds: string[]`, plus `recurse` — the kind is what stops the
scope picker rebuilding a directly-picked file as a folder pick, which it did. A recursive run
costs one Drive request per folder per page.

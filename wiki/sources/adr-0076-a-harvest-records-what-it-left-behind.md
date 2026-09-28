---
title: ADR 0076 A Harvest Records What It Left Behind
type: source
date: 2026-09-28
tags: []
source: docs/adr/0076-a-harvest-records-what-it-left-behind.md
source_path: docs/adr/0076-a-harvest-records-what-it-left-behind.md
source_hash: 5873edde0022078d23dfb79fc39cbc9eddb8c39464eabd214fb6d5559cf57cd4
ingested: 2026-09-28
---

# ADR 0076 A Harvest Records What It Left Behind

# ADR 0076 A harvest records what it left behind, so a wider file-type choice reaches mail already held

Status: Accepted, 2026-09-28. Issue #292. Supersedes, for ATTACHMENTS only, the reading of "held" as "finished with" in [[An ingest streams, and does not re-read what it already holds]] (ADR 0033); its label trade-off stands. Extends [[ADR 0035: A harvest records what it settled, rather than asserting it]] with a second fact on the mark.

## Context

A held Gmail message is skipped whole, and which attachments a harvest takes was decided once, by `scope.fileTypes`, when the message was first read. Adding a type to the choice, or an upgrade admitting a new spelling (v1.27.0: `image/jpg` as JPEG, plus `.eml`, XML, HTML, WebP, `.xlsm`, `.oa`, JSON), landed nothing on held messages while every run reported success. Production: 8,668 and 30,940 held messages in one tenant's two mailboxes ([[ADR 0043 A Second Mailbox Is a Second Source]]); the first mailbox holds no `image/jpg` document, the second 528.

## Decision

* `raw.records.documents_left_behind jsonb` (`330_documents_left_behind.sql`): every attachment part a harvest did not land (refused by the choice, or over the 25 MiB ceiling) as `{documentId, mimeType, extension, declaredBytes}`. Never a filename (`raw.records` is dbt-readable); the MIME type is bare; the extension is what `extensionOf` accepts. Written by `markHarvested` beside `documents_landed`; `knownRecords` returns both.
* `planReads` (`apps/worker/src/services/google/gmailAttachments.ts`): a held message is read again only when its list holds a part the CURRENT choice allows and the ceiling admits; then only the listed parts are considered, so nothing already landed is fetched again, and the mark's count is earlier landed plus landed now.
* Matching is asked of stored facts: `fileFactsOf` and `allowsFacts` in `@undercroft/contracts` (`allowsFile` is the two composed), so a catalogue upgrade counts exactly like a widened choice.
* `NULL` list (every row marked before this) is unknown: read once more in full. `[]` means nothing left behind.
* The run says so: `work_listed.reread`, a `records_reread` Journal line (count and attachments new to the lake), and `ops.run_entity.reread` / `reread_documents` (`340_run_reread.sql`) on the `messages` row, returned by `runs get`; NULL, never 0, where nothing was counted.
* No checkpoint: an unrewritten mark still lists what it left behind, so a cut-off re-read resumes. A message read again lands its current labels; one not read again keeps its stored labels.

## Consequences and cost

Adding a type costs one `messages.get` per held message carrying such a part, once; narrowing costs nothing and deletes nothing; widening back reads only messages harvested while narrow. An over-ceiling part never causes a re-read. Drive is unchanged. At deploy every held Gmail message is read once: 39,608 at 334 ms, about 3 h 40 min (about 48 min and 2 h 52 min for the two mailboxes), plus one re-fetch of each already-landed attachment, which lands as unchanged.

## Rejected

A digest of the file-type policy on the mark ([[ADR 0072 A Watermark Is Keyed on the Request as Sent]]'s shape): re-reads every held message on any change. Gmail `q=has:attachment` / `filename:`: Google does not define which parts they count, so narrowing by them is a guess. Treating legacy rows as harvested under today's choice: false. A `raw.documents` probe to skip re-fetches: permanent code for a one-off. The History API: says what changed, not what a new choice would take. Keeping stored labels on a re-read: discards what was just read.

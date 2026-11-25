---
title: ADR 0161 A Document's Bytes Are Purged Once Extraction Has Had Its Go
type: source
date: 2026-11-25
tags: []
source: docs/adr/0161-a-documents-bytes-are-purged-once-extraction-has-had-its-go.md
source_path: docs/adr/0161-a-documents-bytes-are-purged-once-extraction-has-had-its-go.md
source_hash: 1340d7f09532f702a71b611dd69b02a9e49cef408801aa0dc984f6a54e40398e
ingested: 2026-11-25
---

# ADR 0161 A Document's Bytes Are Purged Once Extraction Has Had Its Go

The product owner decided, knowing the cost, that the platform keeps no second copy of a customer's files: a document's bytes -- a Drive file, a Gmail attachment or body, an archive member, the text on a HubSpot note, call or task -- are deleted from the lake once the extract pass has attempted it (read or refused) and the passes that read bytes again are done (a workbook's rows at the current `rows_version` or a refusal row, an archive's members, which land in the same read). Failed reads are purged too; no backup is taken. It supersedes [[ADR 0001 Raw Lake Is the Only Durable Layer]] for document content and [[ADR 0015 A First-Party Collector for Byte Sources]] on the file name.

**Decision.** A blob goes only when every `raw.documents` row holding its digest, in any source and any tenant, is settled: a document still needs its bytes while they are held and no text was taken from them (including one tombstoned before it was read), its refusal is queued for the current reader generation, or it is a workbook owed its rows -- a superset of `PENDING_JOIN` and `OWED_JOIN`, in `repos/documentPurge.ts`. Deletion goes through the one writer, `LakeStore.purgeBlobs`, which writes a `_reports/blob-purge/` report first and keeps manifests and `_journal/` pointers; a read of a purged observation raises `BlobAbsent`. Every touched document records `bytes_purged_at`, `bytes_purge_outcome` (`deleted` or `absent`) and `bytes_purge_report` -- deleted first, recorded second, so an interrupted purge is finished as `absent`. `raw.documents` gains `file_name` and `source_url` (Drive `/file/d/<id>/view`, Gmail `#all/<messageId>` at `u/0`, a member's archive's link, null for HubSpot and never guessed), written at landing through `DocumentToLand.fileName` and `.link` and kept current on a rename; `metadata.sourceUpdatedAt` stays where it was (migration `700_document_trace.sql`). Each extract pass purges up to 1,000 settled digests of its scope and journals `document_bytes_purged`; the scheduler treats a purgeable scope as due. `task db:document-purge` backfills names and links from manifests, reports what is unread and why, and purges the backlog -- a dry run unless `--apply`, and it does not extract. Purged documents are excluded from both backlogs, so a reader-version bump cannot overwrite a reason with `lake-object-unreadable`; new bytes clear the purge. Harvest skips (Drive's `raw.records` probe, Gmail's `knownRecords`, `put`'s manifest compare) never read a blob, so an unchanged file is not downloaded again.

**Consequences.** A purged document is never re-read by a newer reader, rows generation or archive pass; `raw.document_text` and the workbook rows can no longer be rebuilt; files deleted at the source (about 4,400 in Drive) lose their only copy, except documents tombstoned before they were read, which keep their bytes; a file name is readable by dbt and the control plane, reversing `pii.md`'s filename rule (a subject and addresses stay in the manifest); a Gmail link opens the first signed-in account; a landing racing a purge of the same digest can lose its bytes and is recorded `lake-object-unreadable`, then `absent`; the OOXML accuracy oracle samples only documents not yet purged.

**Rejected.** Keeping the bytes; a file-name column dbt cannot read; purging only successes; promoting `sourceUpdatedAt` to a column; Drive's `webViewLink`; extracting the backlog on the operator's machine.

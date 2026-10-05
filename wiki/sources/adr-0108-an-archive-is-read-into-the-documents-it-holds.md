---
title: ADR 0108 An Archive Is Read into the Documents It Holds
type: source
date: 2026-10-05
tags: []
source: docs/adr/0108-an-archive-is-read-into-the-documents-it-holds.md
source_path: docs/adr/0108-an-archive-is-read-into-the-documents-it-holds.md
source_hash: cff250d64fbe3d7820af8333235bfecf4e8911fd5880b8ab26075d810a800c5b
ingested: 2026-10-05
---

# ADR 0108 An Archive Is Read into the Documents It Holds

A `.zip` is now a picker format (choice `application/zip`, alias `application/x-zip-compressed`, extension `.zip`, `landsAs: application/zip`, read level `members`), and the extract pass reads an archive into the documents it holds. About 200 Gmail zips on `tai-001` had been left behind. It extends [[ADR 0104 Every Workbook Is Landed as Rows]] to workbooks inside archives and revises the catalogue's "nothing here is a zip".

Decision: the archive's own text row is method `zip` with empty text (no words of its own; member names stay in the lake manifest, `pii.md`). Each member whose extension names a catalogue format lands as a document of the archive's source with id `<archive id>/<n>` (its 1-based central-directory position, never its name), `metadata` `archiveDocumentId` and `archiveMember`, type the format's `landsAs` or first MIME type, through the ingest's own document sink (one writer, the same 25 MiB ceiling), and is read on the next pass like any document. Members are not filtered by the scope's file types: choosing archives is choosing their content, the bytes are already in the lake, so ADR 0048 is not widened. Unknown extensions, folders and `__MACOSX` resource forks are left in the archive and counted. Refused by name against the member's own id: `archive-member-encrypted`, `archive-member-unreadable`, `archive-nested` (one level only, so a self-containing zip cannot expand forever), `archive-members-limit` (1,000). An archive whose central directory cannot be read whole (zip64, truncated, not a zip) is `archive-unreadable`; a zip holding `[Content_Types].xml` is an OPC package and is never unpacked. Members follow their archive: re-read lands them again unchanged, positions no longer held are tombstoned, Drive's tombstone keeps a member while its archive is kept, and one digest's members land under every document holding it. `CURRENT_READER_VERSION` goes to 10 so archives refused before are re-read. Rejected: filtering members by scope, landing members at ingest in the collectors, rows keyed by archive and member, nested expansion to a fixed depth.

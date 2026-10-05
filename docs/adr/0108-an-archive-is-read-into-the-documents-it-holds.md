# 108. An archive is read into the documents it holds

- Status: Accepted
- Date: 2026-10-05
- Extends: [ADR 0104](0104-every-workbook-is-landed-as-rows.md) to the workbooks, and every other
  readable file, that arrive inside a `.zip`.
- Revises: the file-format catalogue's "nothing here is a zip" (`fileFormats.ts`), which held
  because no reader opened one.

## Context

On `tai-001` about 200 Gmail attachments are `.zip` files: 81 sent as
`application/x-zip-compressed`, 75 as `application/octet-stream` and 47 as `application/zip`.
They are left behind, because the picker offers no archive format. Senders zip a month of
statements or a set of workbooks together, so a workbook inside an archive is as much a
workbook as one attached on its own. ADR 0104 lands the second as rows, and nothing reaches the
first.

The worker already reads the zip container for OOXML (`zip.ts`). Two things are new: what an
archive's members become, and who decides which members are read.

## Decision

1. **An archive is a format the picker offers.**
   - Its choice is `application/zip`, with `application/x-zip-compressed` as an alias.
   - Its extension is `zip`, and it lands as `application/zip`. So, as with a workbook
     (ADR 0104 decision 6), an admin who also chooses the extension `.zip` admits the
     archives Gmail can only call `application/octet-stream`.
   - Its read level is `members`.
2. **The extract pass reads an archive into the documents it holds.**
   - The archive's own text row has method `zip` and empty text. An archive has no words of
     its own, and its members' names stay out of Postgres (`pii.md`).
   - Each member that lands becomes a document of the archive's source:
     - Its id is `<archive document id>/<n>`, where `n` is the member's 1-based position in
       the central directory. Its position, never its name.
     - Its `metadata` holds `archiveDocumentId` and `archiveMember`.
     - Its name goes to the lake manifest only.
   - From there a member is read like any other document: its text, its rows if it is a
     workbook, its kind. This happens on the next pass, because the pass that lands a member
     does not read it.
   - The bytes are written through `LakeStore`'s create-only path, by the same document sink
     an ingest uses (`documentSink.ts`). This keeps one writer.
3. **A member lands when its extension names a format in the catalogue.**
   - Its type is that format's `landsAs`, or else the format's first MIME type.
   - A member's name is the only label it has. Inside an archive no provider declares a type,
     so the MIME-first rule of `fileMatching.ts` has nothing to ask first.
   - A member whose extension the catalogue does not know is left in the archive, and counted
     in the journal. A directory entry is skipped, and so is the macOS resource fork that Finder
     writes beside every file (`__MACOSX/`, `._name`); neither is a document.
4. **Which members are read is not filtered by the scope's file types.**
   - Choosing the archive format is choosing what is inside it. The bytes were collected under
     that consent, and are already in the lake.
   - Landing a member copies bytes the lake holds into a document the readers can open. It is
     not a second collection, so ADR 0048, which governs what is fetched from a provider, is
     not widened.
5. **A member that cannot be landed exactly is refused by name, against its own id, in the
   pass's ledger.**
   - `archive-member-encrypted`: the member's bytes are encrypted. Unlike an encrypted OOXML
     package, a zip-encrypted member's stored bytes would otherwise pass for its plain ones.
   - `archive-member-unreadable`: a compression method other than stored or deflate, or a
     corrupt stream.
   - `archive-nested`: an archive inside an archive is not expanded. One level is what mail
     carries, and a zip that contains itself would otherwise expand one level per pass,
     forever.
   - `archive-members-limit`: past 1,000 members in one archive.
   - A member declared larger than 25 MiB is refused by the document sink's own ceiling,
     unfetched, as any oversized document is.
   - An archive that cannot be indexed exactly is refused whole as `archive-unreadable`. That
     covers a zip64 archive, a truncated central directory, and a file labelled a zip that is
     not one. "No members" would be a guess.
   - A zip holding `[Content_Types].xml` is an OPC package: a `.docx`, an `.xlsb`, a `.vsdx`. It
     is one document in a format of its own, and is never unpacked, because its XML parts would
     land as documents nobody sent. A workbook package is read as the workbook it is (ADR 0104
     decision 5), and any other stays `unsupported-content-type`.
6. **Members follow their archive.**
   - An archive read again lands its members again. The lake answers `unchanged`, and the
     catalogue row stays as it is.
   - A member whose position the archive no longer holds is tombstoned, because the archive
     changed.
   - Drive's tombstone of a file no longer in scope keeps a member while its archive is kept.
     A member's id is never in a listing, so without this rule every Drive ingest would
     tombstone every member.
   - One archive attached to several messages is one digest read once. Its members land under
     every document holding that digest, so each message keeps its own.
7. **Archives refused by an older reader are read again.** `CURRENT_READER_VERSION` rises, so an
   archive landed under a typed-in `application/zip` choice and refused
   `unsupported-content-type` is re-offered once.

## Consequences

- A workbook in a zip reaches `source('undercroft', 'document_rows')` one pass after its archive
  is read. A model reaches the archive through `metadata->>'archiveDocumentId'`.
- An archive of images is OCR'd member by member, because image formats are in the catalogue.
  That is what choosing archives means, and the cost is one document each.
- Run counts: an ingest counts the archive as one document. The extract pass counts its own
  reads, and journals the members it landed separately.

## Options rejected

- **Filtering members by the scope's file types.** The extract pass does not hold the scope.
  Widening the choice later would also leave the members it excluded with no pass that comes
  back for them, so a member's fate would depend on when the scope was edited.
- **Landing members at ingest time, in the collectors.** Every collector would need archive
  code, a member would be fetched and counted in two places, and an archive landed before this
  ADR would never be expanded.
- **Rows keyed by archive and member, with no member documents.** Every reader, the text search
  and the kind classifier key on a document. Members as documents get all of them for nothing,
  while a second key would need each of them taught it.
- **Expanding nested archives to a fixed depth.** One level covers the measured mail, and every
  extra level multiplies the work a 25 MiB attachment can demand.

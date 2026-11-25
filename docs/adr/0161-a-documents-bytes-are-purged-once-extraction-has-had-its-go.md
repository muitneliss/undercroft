# 161. A document's bytes are purged once extraction has had its go, and its row says where the file is

- Status: Accepted
- Date: 2026-11-25
- Supersedes: [ADR 0001](0001-raw-lake-is-the-only-durable-layer.md) for document content only --
  a document's bytes are no longer kept, so `raw.document_text` and the workbook rows can no
  longer be rebuilt from the lake; and [ADR 0015](0015-a-first-party-collector-for-byte-sources.md)
  on one point -- a document's file name now reaches `raw.documents`, which dbt reads.
- Decided by: the product owner, explicitly, after being told the consequences below. This
  record states the decision and its cost; it does not argue it.

## Context

Every document this platform reads -- a Drive file, a Gmail attachment or body, a member of an
archive, the text written on a HubSpot note, call or task -- lands through `landDocuments` into the
lake (`LakeStore.put`, content-addressed) and is catalogued in `raw.documents`. The extract pass
reads it into `raw.document_text`, a workbook into `raw.document_sheets`/`document_rows`, and an
archive's members land as documents of their own (ADR 0024, 0104, 0108).

Until now the bytes were kept for ever, on ADR 0001's rule that the lake is the only durable
layer and everything in Postgres a projection that can be rebuilt from it. In production that is
about 196,000 documents, about 51 GB by `byte_length` and about 31 GB of distinct blobs, with 241
documents not yet read and 3,336 archive members.

These files live in the customer's own Drive and mailbox. The owner decided the platform should
not keep a second copy of them once it has read them.

## Decision

1. **A document's bytes are deleted once the extract pass has attempted it** -- read it, or
   refused it with a reason -- **and the passes that need its bytes again are done**: a workbook's
   rows written (`raw.document_sheets` at the current `rows_version`, or a refusal row for it), an
   archive's members landed (which happens in the same read that writes the archive's text). A
   failed or refused read is purged too. No backup is taken first.
2. **A blob goes only when every document holding it, in any source and any tenant, is settled.**
   The lake stores a blob once per content, so one `_blobs/` object can be named by many documents.
   A document still needs its bytes while they are held and: no text was taken from these bytes
   (never read, read from earlier bytes, or tombstoned before it was ever read); or its refusal is
   queued for the current reader generation; or it is a workbook owed its rows. The predicate is a
   superset of the two backlogs that read the lake (`PENDING_JOIN`, `OWED_JOIN`), restated in
   `apps/worker/src/repos/documentPurge.ts`.
3. **Through the one writer.** `LakeStore.purgeBlobs` deletes the digests it is named, after
   writing one `_reports/blob-purge/` report naming all of them and who asked. It knows nothing of
   Postgres or documents; deciding is the caller's. Manifests and `_journal/` pointers stay: they
   are tiny, `put` decides `unchanged` from the newest manifest, and the trace backfill reads them.
   A read of an observation whose blob is gone raises `BlobAbsent`, not a bare not-found.
4. **Every purge is recorded on every document it touched**, in `raw.documents`:
   `bytes_purged_at`, `bytes_purge_outcome` (`deleted`, or `absent` when the blob was already
   gone) and `bytes_purge_report` (the lake report's key). Deleted first, recorded second, so a
   purge cut off between the two is found again and recorded `absent` rather than claimed done.
5. **The row says where the file is.** `raw.documents` gains `file_name` (the source's name for
   the file; a member's path inside its archive) and `source_url` (a Drive file's
   `https://drive.google.com/file/d/<id>/view`; a Gmail message's
   `https://mail.google.com/mail/u/0/#all/<messageId>` for its attachments and its body; a member's
   archive's link). Either is `null` where the source gives none or none can be derived, never
   guessed: a mail's body has no file name, and the text on a HubSpot note has neither -- a
   HubSpot record's address needs the portal id, which no landing carries; the record is found
   by `metadata.sourceRecordId` in `raw.records`. Both are written at landing time through `DocumentToLand.fileName` and `.link`,
   and kept current when a file is renamed at the source without its bytes changing. The source's
   modified time stays where it was, `metadata.sourceUpdatedAt`, beside `observed_at`. A failed
   read's detail stays as it was: `raw.document_text` keeps the reason, the reader generation and
   when; `raw.documents` keeps the content type, the size, the digest, and now the name and link.
6. **Where it runs.** At the end of every extract pass, for up to 1,000 digests held by that
   pass's (tenant, source), reported as a `document_bytes_purged` journal event with counts and
   bytes. The scheduler counts a scope holding a purgeable digest as due (`purgeableScopes`), so a
   digest whose last reader was in another scope does not wait for unrelated work. For the backlog
   on the day this ships there is `task db:document-purge`: it backfills `file_name` and
   `source_url` from the lake manifests, reports what is still unread and why, and purges every
   settled digest -- a dry run unless `--apply` (`docs/runbook/deployment.md`, "Purging document
   bytes"). It does not extract: a reading made on the operator's machine with other versions of
   poppler and tesseract would be a reading the pipeline did not make.
7. **A purged document is never offered again.** `PENDING_JOIN` and `OWED_JOIN` exclude it, so a
   reader-version bump cannot overwrite its reason with `lake-object-unreadable` and a rows
   generation bump cannot keep the hourly scheduler starting runs for it. New bytes landing for it
   clear the purge record, so a changed file is read, then purged in its turn.
8. **What a harvest skips is unchanged.** Drive's skip is `raw.records` and its harvest mark; Gmail's
   is `knownRecords`; `LakeStore.put` compares manifests. None reads a blob, so an unchanged file is
   not downloaded again after its bytes are purged. The same bytes landed at another key find no
   blob and are stored afresh, because that document has not been read.

## Consequences

Accepted by the owner, and stated so nobody rediscovers them:

- **A purged document cannot be read again.** No re-read when a reader improves
  (`CURRENT_READER_VERSION`), no workbook rows when `CURRENT_ROWS_VERSION` moves, no archive opened
  a second time. A refusal recorded today is the document's answer for good.
- **ADR 0001 no longer holds for document content.** `raw.document_text`, `raw.document_sheets` and
  `raw.document_rows` cannot be rebuilt from the lake; dropping them loses the only reading there
  will be. `raw.records` is unaffected and still rebuilds from the lake.
- **A file deleted at its source loses its only copy** -- about 4,400 Drive files in production.
  Their name, link, digest and reading remain. A document tombstoned before it was ever read is the
  exception: nothing has attempted it, so its bytes are kept and the dry run names it
  `tombstoned-before-read`.
- **A file name is readable by dbt and by whatever a customer builds on it.** It is in
  `raw.documents`, which every tenant's dbt login reads, and the control plane reads it to show the
  Lake division's document list. This reverses the filename rule in `.claude/rules/pii.md`, which is
  updated in the same change. A mail's subject and addresses, a folder's name, and a document's
  text are where they were: the manifest, the manifest, and `raw.document_text`.
- **A Gmail link opens the first signed-in account** (`u/0`). A reader signed in to several Google
  accounts may need to switch to the mailbox the message is in. The mailbox's address in the URL
  would select it, and would put an address in a dbt-readable column, which the decision did not
  extend to.
- **One narrow race is named rather than closed.** A document landing the same bytes as a digest
  being purged, between the purge's question and its delete, can find the blob and skip writing it,
  then lose it. That document is not marked purged; the extract pass records it
  `lake-object-unreadable` with its reason, and the next purge marks it `absent`. Its file is still
  at its source.
- **The OOXML accuracy oracle can only sample documents between landing and purge**
  (`task db:extract-accuracy`), and says so when there are none.
- `extractionAccuracyCli.ts` reads bytes and now tells a purged blob from an unreadable one.

## Options rejected

- **Keep the bytes.** The previous design, and the one ADR 0001 argues for. The owner weighed it
  and decided the platform should not hold a second copy of files the customer already holds.
- **Put the file name in a column dbt cannot read** -- a separate table granted to the worker and
  the control plane only. The owner chose the name to be readable where the rest of the catalogue
  is, so a model can show a person which file a row came from. A column hidden from dbt would also
  have been the first exception to `raw.documents` being one grant.
- **Purge only successful reads, keeping failures for a later reader.** Most failures are files no
  reader will open (an unsupported type, an encrypted archive, a signature image), and keeping them
  keeps exactly the bytes nothing uses. A failure's detail is kept instead, which is what tracing it
  needs.
- **Promote `sourceUpdatedAt` to a column.** It would be a second copy of a fact `metadata` already
  holds, which existing models read.
- **Drive's `webViewLink`.** A field on every listing, a different spelling only for native Docs,
  and unavailable to the backfill -- so the column would hold two spellings of one link.
- **Extract the backlog in the operator command.** See Decision 6.

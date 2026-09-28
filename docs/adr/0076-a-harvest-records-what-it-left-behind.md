# 76. A harvest records what it left behind, so a wider file-type choice reaches mail already held

- Status: Accepted
- Date: 2026-09-28
- Supersedes, in part: [ADR 0033](0033-an-ingest-streams-and-does-not-re-read-what-it-holds.md)'s
  "for Gmail, 'already held' means already fetched", as it applies to ATTACHMENTS. ADR 0033
  recorded that trade-off for labels and priced it for labels; it never considered file types,
  and the skip it describes lost attachments as well. The label trade-off stands unchanged.
- Extends: [ADR 0035](0035-a-harvest-records-what-it-settled-rather-than-asserting-it.md). The
  mark gains a second fact beside `documents_landed`, written by the same `markHarvested`, for
  the same reason.

## Context

Issue #292. A Gmail harvest skips a message it already holds, marked complete, without fetching
it. Which attachments a message's harvest takes is decided by the connection's file-type choice
(`scope.fileTypes`), and that decision was made once, when the message was first read. So when
an admin added a type to the choice, attachments of that type landed on every NEW message and on
no message already held. The same happened when an upgrade taught the catalogue a new spelling
of a chosen type: v1.27.0 admitted `image/jpg` as JPEG and added `.eml`, XML, HTML, WebP,
`.xlsm`, `.oa` and JSON. Every run reported success.

Production shows it. One tenant has two mailboxes (a second mailbox is a second source, ADR
0043): 8,668 held messages in the first and 30,940 in the second. Documents of `text/xml`,
`text/html`, `image/webp` and `message/rfc822` exist only as three test messages landed after
the upgrade. The first mailbox holds no `image/jpg` document at all. The second, ingested after
the upgrade, holds 528.

## Decision

**A harvest records, on the mark, every attachment part it left behind.** `raw.records` gains
`documents_left_behind jsonb` (`packages/db/sql/330_documents_left_behind.sql`). It lists each
attachment part the harvest did not land, either because the choice refused it or because it is
over the 25 MiB ceiling. Each entry is `{documentId, mimeType, extension, declaredBytes}`:

- `documentId` is the id the part would land under, `(messageId, partIndex)`;
- `mimeType` and `extension` are the two facts file matching reads;
- `declaredBytes` is the fact the ceiling reads.

It never holds a filename, because `raw.records` is readable by dbt (ADR 0015). The MIME type is
bare, since its parameters can carry a filename. The extension is only the one-to-eight
character suffix `extensionOf` accepts. `markHarvested` writes the list beside the count, after
the projection, and `knownRecords` hands both back.

**A held message is read again only when its list holds a part the CURRENT choice allows and
the ceiling admits** (`planReads` in `apps/worker/src/services/google/gmailAttachments.ts`). Then only the
listed parts are considered: those now allowed are offered, those still refused stay on the new
list, and a part that already landed is neither fetched nor listed. The new mark's count is what
earlier harvests landed plus what lands now. Otherwise the message is skipped exactly as before.

**The question is asked of stored facts, by this release's matcher.** `@undercroft/contracts`
now exposes `fileFactsOf` (the facts of a described file) and `allowsFacts` (matching over those
facts); `allowsFile` is the two composed. So a catalogue that admits a new spelling finds the
parts it now admits the same way a widened choice does, without a digest or a version to bump.
The contract is that matching reads nothing about a file but these two facts; `FileFacts` says
so where a change to matching would have to see it.

**A mark that lists nothing is unknown, not empty.** `NULL` is every row marked before this
change. Such a message is read once more in full, like a message never read, because skipping it
would be a guess that it carries nothing wanted (CLAUDE.md rule 2). That is the repair for the
attachments production is missing today. `[]` is the recorded answer "nothing left behind".

**The run says what it re-read.** `work_listed` carries `reread`, the held messages among the
reads, and the Journal words a listing with a non-zero `reread` as its own sentence. When any
held message was read again, a `records_reread` line follows the documents line with how many,
and how many attachments that reading stored for the first time. The same two numbers are kept
on the run's `messages` row in `ops.run_entity` (`reread`, `reread_documents`, in
`340_run_reread.sql`), which is what `runs get` returns over the CLI and MCP. They are `NULL` for
every row that has nothing to say, never `0`. They are counted as items settle, so a stopped
run's numbers are what it actually did.

**Nothing checkpoints a re-read.** A message whose mark has not been rewritten still lists what
it left behind, so a run cut off part-way leaves exactly the unfinished messages for the next
run, which finds them the same way (ADR 0033, ADR 0051).

**A message read again lands its record as any read does,** so its labels are the ones Gmail
gives now. That is a fact arriving, not a sweep for one: a held message that is not read again
keeps its stored labels, and ADR 0033's label trade-off is untouched.

## Consequences

- Adding a type costs one `messages.get` for each held message that carries a part of that type
  under the ceiling, once, and nothing for any other message. Narrowing the choice costs nothing
  and deletes nothing; the lake is create-only. Widening back reads only messages harvested while
  the choice was narrow, because what landed earlier is not on their lists.
- A part over the ceiling never makes its message be read again. It stays on the list, so a
  ceiling raised one day (which first needs a streaming lake path) finds it without a migration.
- A part over the ceiling that the choice allows is offered again, and its size refusal recorded
  again, whenever its message is read again for a different part. The refusal is true of that
  run too.
- Drive is unchanged. A Drive file of an unchosen type is never listed, so a widened choice
  already lists it as new. Drive marks store `NULL` here and Drive never reads the column.
- If `extensionOf` ever accepts a longer or different suffix, the extensions stored before that
  change are what the old rule found. `FileFacts`' docstring says so where that change is made.
- Rebuilding `raw.records` from the lake leaves the column `NULL` and costs one more full read of
  each mailbox, the same caveat ADR 0035 records for `documents_landed`.

## Cost

**At the deploy, every held Gmail message is read once more**, because none of them says what it
left behind. On production that is 39,608 `messages.get` at the paced 334 ms, about 3 h 40 min
of reading: about 48 minutes for the first mailbox (8,668) and about 2 h 52 min for the second
(30,940), each in its own runs. The re-read also fetches again each attachment that had already
landed, at the same pace, because a legacy mark cannot say which parts those were. The lake
stores nothing new for them (it is idempotent by content), and the run counts them as
`unchanged` documents, not as new. A deploy that interrupts the re-read costs nothing: the next
run carries on from the messages whose marks were not yet rewritten. While a mailbox's re-read
runs, its schedule waits, as for any long run (a second run of the same source is refused, not
queued). After that one read, every run skips as before.

## Options rejected

- **Key the mark on a digest of the file-type policy**, as [ADR 0072](0072-a-watermark-is-keyed-on-the-request-as-sent.md)
  keys a watermark on the request as sent, with the digest also covering the catalogue's rules so
  that an upgrade counts. It is the smaller diff and it is always correct, and it re-reads EVERY
  held message whenever the digest moves: 3.7 hours on production for adding a type no message
  carries, for removing one, and for any catalogue edit to a chosen format. It cannot tell which
  messages could hold the new type, because nothing about their parts was kept. The issue asks
  for exactly that distinction.
- **Narrow the listing with Gmail search** (`q=has:attachment`, `filename:xml`), one request per
  hundred ids. Google's search help says only that `has:attachment` finds emails that "include:
  Attachments", and that `filename:` finds "attachments with a certain name or file type". It does
  not define which MIME parts either counts. A message it leaves out would be a guess that it
  carries nothing wanted, and a MIME-only spelling such as `image/jpg` on a file with no matching
  extension is exactly what `filename:` cannot see. Rule 2 forbids that guess, and the complete
  answer is one read per message anyway.
- **Treat the legacy rows as harvested under today's choice and catalogue.** It would cost
  nothing at deploy, and it is false: the choice may have changed since, and the catalogue did
  change. The first mailbox's missing `image/jpg` documents are the evidence.
- **Look up `raw.documents` before fetching an attachment again**, to spare the legacy re-read its
  second download of what already landed. It is permanent code, and a second query on every read,
  to save a one-off cost the lake already makes harmless. A re-read of a message with a list
  already offers only the parts that did not land, so after the one-off there is nothing left
  for it to save.
- **Gmail's History API.** It reports what changed in the mailbox, not what a new choice would
  take from mail that has not changed. It does not help here.
- **Keep the stored labels on a message read again.** That would mean discarding labels Gmail has
  just returned in favour of older ones. ADR 0033 accepted stale labels to avoid reading; it never
  asked for a read to ignore what it read.

# 57. A NUL in extracted text is replaced where it stood, and a byte-order mark is believed

- Status: Accepted
- Date: 2026-09-25

## Context

Issue #218: three hourly extract runs over one tenant's Drive failed with
`invalid byte sequence for encoding "UTF8": 0x00`. Each read 495 of its 500 documents, then
recorded nothing, and the pending backlog grew from 2,369 to 3,569 while the readable count
stood still.

Two facts combined:

- The plain-text and JSON readers decode with a non-fatal UTF-8 `TextDecoder`. A NUL byte is
  valid UTF-8, so U+0000 survives into the text. The HTML, MIME, Word and OCR paths can hand
  one over too.
- `upsertDocumentText` writes a batch as ONE `INSERT ... FROM unnest(...)`. A Postgres `text`
  column cannot hold U+0000, so one document failed the statement, none of the batch was
  written, and the next run drew the same batch and failed the same way.

The likeliest source is a UTF-16 text file -- Excel's "Unicode Text" export and many bank
statements are UTF-16 behind a `FF FE` mark -- read as UTF-8, where every other byte is a NUL.
That is a hypothesis from the file types involved, not a measurement.

## Decision

**U+0000 becomes U+FFFD, in `extractText.ts`'s `read`**, the one constructor every reading
passes through before it can reach the table. It is replaced where it stood, the text keeps its
length, and the document is read rather than refused.

**A plain-text or JSON file with a UTF-16 byte-order mark is decoded as UTF-16**, little- or
big-endian as the mark says. Without a mark it is read as UTF-8, as before.

**The write stays one statement.** With the NUL impossible, no value a reader can produce is one
Postgres refuses: `pg` encodes a JS string as valid UTF-8 (a lone surrogate becomes U+FFFD in
the encoder), and the `document_text_said_why` CHECK and the digest are the caller's by
construction.

**`CURRENT_READER_VERSION` is not bumped.** A bump re-offers refusals, and the documents this is
for never got a row at all, so they are still in the backlog without one.

## Options rejected

- **Drop the NUL.** It looks cleanest and that is the defect. A NUL in a text document is never a
  word; it is the trace of a file that is not what it was labelled. A mark-less UTF-16 file
  with its NULs dropped prints its ASCII cleanly beside mangled accents -- a reading that looks
  right and is not, which `CLAUDE.md` rule 2 forbids. U+FFFD is the character the non-fatal
  decode already writes for a byte that is not text, so the row says where that happened.
- **Refuse the document.** One byte would cost every readable word in the file, which is what
  the non-fatal decode was chosen to prevent.
- **Scrub in the repo.** `documentText.ts` is the single writer, so it would be a sure choke
  point, but what the character becomes is a decision about the value, and the repo decides
  nothing (`layering.md`). `read` reaches every reading just as surely.
- **Write row by row, or retry the batch one row at a time on failure.** It would contain a
  failure no reader can now produce, at the cost of 500 statements per run or a second write
  path. If a new class of value Postgres refuses appears, the fix belongs where the value is
  made, as this one's did.
- **Detect mark-less UTF-16 by counting zero bytes.** A heuristic over the content is a guess at
  an encoding the file does not state. Such a file stays readable-but-visibly-wrong, and the
  U+FFFD it carries is what lets a reader find it.

## Consequences

- A run over a source holding such a file succeeds, and the backlog drains.
- A UTF-16 export with a mark is read as the words it holds, Vietnamese included.
- The reporter's secondary ask -- that a failed run record what it read before the error -- is
  not done here. With a one-statement write, a failed run stored nothing, so its zero counts are
  true; counting reads that never reached the table would put a number beside the run with no
  row behind it.

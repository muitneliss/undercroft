# 53. A legacy Word document is read in process, and only Word 95 stays refused

- Status: Accepted
- Date: 2026-09-25
- Supersedes: the `.doc` half of the first option ADR 0036 rejected, which kept
  `application/msword` refused as `legacy-doc-unsupported`. The refusal of `soffice` itself
  stands, and so does the `.xls` refusal.

## Decision

A `.doc` is read by the worker, in process, with no converter in the image and no new
dependency. Three modules do it:

- **`cfb.ts`** opens the Compound File Binary container ([MS-CFB]): the header, the FAT and its
  DIFAT, the directory, the mini stream. It returns a stream that is a direct child of the root,
  by name, or `null`.
- **`doc.ts`** reads the File Information Block and the piece table ([MS-DOC]) and decodes every
  piece: two bytes a character as UTF-16, one byte a character as Windows-1252.
- **`docTables.ts`** reads the paragraph-property pages only far enough to tell a table row's
  end mark from a cell's, which the text cannot.

The method is `doc`. Three reasons replace the one:

| Reason                   | When                                           | Who acts                           |
| ------------------------ | ---------------------------------------------- | ---------------------------------- |
| `legacy-doc-unsupported` | saved by Word 95 or earlier (`nFib` below C0h) | nobody; a fact about the document  |
| `doc-password-protected` | the FIB's `fEncrypted` bit is set              | nobody here; the sender can unlock |
| `doc-unreadable`         | anything that cannot be read exactly           | an operator, as `docx-unreadable`  |

`CURRENT_READER_VERSION` goes to 5, which re-offers every `.doc` already recorded
`legacy-doc-unsupported`.

## Why

### LibreOffice was never the only way, only the one that was named

ADR 0028 refused LibreOffice as "a container's worth of dependency for two files", and ADR 0036
repeated it. Both were right about LibreOffice. Neither asked whether a `.doc` needed a
converter at all, and for text it does not.

A Word 97 file keeps every character in one place: the piece table in the `Clx`, which lists
runs of characters, where each run sits in the `WordDocument` stream, and whether it is stored
one byte or two a character. Styles, fields, drawings and page layout are elsewhere, and a
reader that wants only the words never has to open them. The container is a FAT filesystem in
miniature, and reading it is the same size of problem as the zip reader `zip.ts` already is.
The whole read path is under 750 lines across the three modules.

So this is ADR 0028's own argument applied once more. The worker is the one process that holds
`UNDERCROFT_SECRET_KEY`, so an npm parser there is a supply-chain surface, and a file format we
can parse exactly is parsed here.

### Every piece is read, not the body's character count

The piece table covers the body and every subdocument after it — footnotes, headers and footers,
comments, endnotes and text boxes — in one character space. `ccpText` in the FIB says where the
body ends, and a reader that stops there loses the fee a Vietnamese contract puts in a text box.
That is the second of the two bugs `docx.ts` records a sibling project paying for. Reading every
piece is the `.doc` form of `docx.ts`'s lexical rule: nothing asks which kind of story a
character belongs to, so no kind of story can be missed.

### Word 95 stays refused because reading it would be a guess

Word 97 and later store any character outside Windows-1252 as a two-byte piece. [MS-DOC] 2.4.1
fixes a one-byte piece as Windows-1252, whatever language the document is in, so a Word 97 file
decodes exactly. Word 6 and 95 have no two-byte pieces: their 8-bit text is in the codepage of
the machine that saved the file, which the file does not state. Decoding a Vietnamese Word 95
file as Windows-1252 would not fail. It would return confident Latin letters that were never in
the document, which is `CLAUDE.md` rule 2 broken without an error. So `legacy-doc-unsupported`
keeps its name and narrows to that one case, and its note tells the reader how to get the text:
open the file in Word and save it as `.docx`.

### Table rows need one paragraph property

A cell ends with character 7, and so does a row. Nothing in the text tells them apart: a row
holding an empty cell and a row end are the same two characters. `sprmPFTtp` on the row's
paragraph mark does, and `sprmPFInnerTtp` and `sprmPFInnerTableCell` do the same for a nested
table, whose marks are ordinary paragraph marks. Without them every table reads as one line,
which is the table semantics ADR 0036 records a sibling project losing irrecoverably.

The property decides a separator and never a character. A misread would put a newline where a
`|` belonged, and the words would be the same. That is why `docTables.ts` walks each property
list only far enough to find three flags. It still refuses a list whose lengths run off its
page, because a corrupt page is a corrupt file.

### What was measured

- **Against LibreOffice's own writer.** Documents written by `soffice --convert-to doc` read
  exactly: Vietnamese body text, curly quotes and `café` in one-byte pieces, a table with an
  empty leading cell, a nested table, a text box, a hyperlink field, headers, footers and a
  footnote. On the nested table, LibreOffice's own text export gives the same rows. That export
  drops the text box and the footnote, and this reader keeps them.
- **Size.** An 11.7 MB `.doc` of 60,000 paragraphs, whose FAT needs a DIFAT sector, reads in
  128 ms.
- **The suite's fixtures are real files.** `docOf` (`docTesting.ts`, with `cfbTesting.ts` for
  the container) writes the container, the FIB, the piece table and the property page, and LibreOffice opens its output as a document
  with a table. That is the evidence the fixture is the format, and not a byte string shaped
  only for this reader.

Word itself was not available to test against. Every file above was written by LibreOffice or
by `docOf`.

## Cost

- **A second binary format to maintain.** Its read path is small, but it is ours. The
  mitigation is the one `zip.ts` has: read only what the text needs, and refuse rather than
  guess at the edges.
- **The property lists are walked, not understood.** Two variable-length properties
  (`sprmTDefTable`, `sprmPChgTabs`) have their own size rules, and a third that Word writes one
  day would fail the document as `doc-unreadable`. That is a visible refusal, never wrong text.
- **A piece's own formatting (`Prm`) is ignored.** It could in principle set a row flag on a
  paragraph after the fact. The worst case is a cell separator where a line break belonged.
- **`.xls` is still refused.** It shares the container, and `cfb.ts` opens it, but its cells are
  BIFF records, a second format with no reader yet. That reader can now start from `cfb.ts`.

## Options rejected

- **LibreOffice (`soffice --headless --convert-to txt`).** Rejected in ADR 0028 and ADR 0036,
  and nothing here changes that: an office suite in the image, a process started for every
  conversion, and its own text export drops text boxes and footnotes.
- **`antiword` or `catdoc`.** Small Debian packages, but neither has had a release in years,
  and each is one more binary invoked from the worker for a read that fits in the process.
  `catdoc` also decodes 8-bit text through a configured default codepage, which for a Word 95
  file is the guess this ADR refuses to make.
- **An npm parser (`word-extractor`, `cfb`).** A dependency tree in the process that holds the
  key, for a format this repo can parse exactly. It is the same reasoning as ADR 0028's.
- **Reading only `ccpText`.** It loses text boxes, headers, footers and notes, for no saving.
- **Decoding Word 95 as Windows-1252.** Wrong for every Vietnamese Word 95 file, and wrong
  silently.

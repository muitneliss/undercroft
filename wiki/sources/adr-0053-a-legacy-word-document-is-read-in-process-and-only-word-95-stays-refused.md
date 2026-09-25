---
title: >-
  ADR 0053: A legacy Word document is read in process, and only Word 95 stays
  refused
type: source
date: 2026-09-25
tags: []
source: docs/adr/0053-a-legacy-word-document-is-read-in-process.md
source_path: docs/adr/0053-a-legacy-word-document-is-read-in-process.md
source_hash: 3360bb0b65f0198d641c5dd6510f531c0782be88c6fb5c4abe7f9f26c80d5803
ingested: 2026-09-25
---

# ADR 0053: A legacy Word document is read in process, and only Word 95 stays refused

# ADR 0053: A legacy Word document is read in process, and only Word 95 stays refused

Accepted 2026-09-25. Supersedes the `.doc` half of the first option [[The readers ADR 0028 deferred, and a refusal that can be retried]] rejected, which kept `application/msword` refused as `legacy-doc-unsupported`. The refusal of `soffice` itself stands, and so does the `.xls` refusal.

**Decision.** The worker reads a `.doc` in process, with no converter in the image and no new dependency. `cfb.ts` opens the Compound File Binary container (header, FAT and DIFAT, directory, mini stream) and returns a stream that is a direct child of the root, by name. `doc.ts` reads the FIB and the piece table and decodes every piece: two bytes a character as UTF-16, one byte as Windows-1252. `docTables.ts` reads the paragraph-property pages only far enough to tell a row end from a cell end. The method is `doc`. Three reasons replace the one: `legacy-doc-unsupported` now means only a file saved by Word 95 or earlier (`nFib` below C0h), a fact about the document; `doc-password-protected` is the FIB's `fEncrypted` bit, bytes intact, the sender can unlock; `doc-unreadable` is anything that cannot be read exactly, for an operator as `docx-unreadable` is. `CURRENT_READER_VERSION` goes to 5, which re-offers every `.doc` already refused.

**Why.** [[ADR 0028: A workbook is read in process, and extract is scheduled by backlog]] was right about LibreOffice but never asked whether text needed a converter; it does not. A Word 97 file keeps every character in the piece table, and the container is the same size of problem as `zip.ts`. The worker holds `UNDERCROFT_SECRET_KEY`, so an npm parser there is a supply-chain surface. Every piece is read, not just the body's `ccpText`, so footnotes, headers, footers, comments, endnotes and text boxes arrive: the `.doc` form of `docx.ts`'s lexical rule. Word 95 stays refused because its 8-bit text is in the saving machine's unstated codepage; decoding it as Windows-1252 would return confident wrong letters (`CLAUDE.md` rule 2). A cell and a row both end with character 7, so `sprmPFTtp` (and `sprmPFInnerTtp`, `sprmPFInnerTableCell` for nested tables) decides the separator; it never decides a character.

**Measured.** Files written by `soffice --convert-to doc` read exactly: Vietnamese, curly quotes and `café` in one-byte pieces, a table with an empty leading cell, a nested table, a text box, a hyperlink field, headers, footers and a footnote; LibreOffice's own text export drops the text box and the footnote. An 11.7 MB file of 60,000 paragraphs, whose FAT needs a DIFAT sector, reads in 128 ms. The suite's fixture writer (`docTesting.ts`, `cfbTesting.ts`) produces files LibreOffice opens with the table intact. Word itself was not tested against.

**Cost.** A second binary format to maintain. Property lists are walked, not understood: an unknown variable-length property would fail a document as `doc-unreadable`, never produce wrong text. A piece's own `Prm` is ignored; the worst case is a cell separator where a line break belonged. `.xls` stays refused: it shares the container but its cells are BIFF, which has no reader yet.

**Rejected.** LibreOffice (an office suite in the image, a process per conversion, and its export drops text boxes and footnotes); `antiword`/`catdoc` (no releases in years, another binary, and `catdoc` decodes 8-bit text through a configured codepage); an npm parser (`word-extractor`, `cfb`) in the process that holds the key; reading only `ccpText`; decoding Word 95 as Windows-1252.

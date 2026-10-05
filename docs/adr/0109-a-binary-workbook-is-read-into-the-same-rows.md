# 109. A binary workbook is read into the same rows

- Status: Accepted
- Date: 2026-10-05
- Extends: [ADR 0104](0104-every-workbook-is-landed-as-rows.md) decision 7, which renders a
  BIFF8 number once and never computes with it, to the BIFF12 records of an `.xlsb`. It also
  extends decision 5's list of what the bytes decide: `xlsb-unsupported` is no longer one of its
  refusals.
- Follows: [ADR 0106](0106-a-sheet-is-read-as-it-inflates.md) for the sheet parts, and
  [ADR 0108](0108-an-archive-is-read-into-the-documents-it-holds.md) decision 5, which reads a
  workbook package as the workbook it is.

## Context

An Excel binary workbook (`.xlsb`) is refused as `xlsb-unsupported`. The picker offers the
format, so an admin can choose it, and every file that lands under it is refused. Finance teams
save large ledgers as `.xlsb` because the file is smaller and opens faster. Those are the
workbooks a model most needs as rows.

The format is the `.xlsx` package with each part written as binary records instead of XML
([MS-XLSB]). Three things already exist that a reader needs:

- `_rels/.rels` names the workbook part, and the workbook part's own relationships name each
  sheet, the shared strings and the styles. The relationship types are the ones an `.xlsx` uses.
- A number is an IEEE-754 double (`Xnum`) or an `RkNumber`, the same encodings BIFF8 uses.
  `biff8Values.ts` already renders both exactly.
- The sheets, rows, number formats and refusals are the same model the `.xlsx` and `.xls`
  readers produce, through `assembleWorkbook`.

What is new is the record grammar (§2.1.4). A record's type is a variable-length integer of one
or two bytes, and its size is one of one to four bytes. A sheet part grows with its data, like
an `.xlsx` sheet's XML.

## Decision

1. **An `.xlsb` is read in process into the same sheets of rows.** The method is `xlsb` and the
   container is `xlsb`. The rows go to `raw.document_rows` and the text to `raw.document_text`,
   from one parse, as for the other workbooks. No converter and no dependency is added, for
   ADR 0028's reason.
2. **Parts are found through the package's relationships, exactly as for an `.xlsx`.** The rules
   for following a relationship move into one module, `opcPackage.ts`, which both workbook
   readers use:
   - a part name is matched case-insensitively;
   - an external target is never a part;
   - a target is resolved against the part that declares it;
   - a relationship type is matched on its last segment.

   A sheet's kind comes from its relationship type, through the same table. An `.xlsb` has no
   conventional-name fallback. The `.xlsx` reader keeps its fallback because workbooks were read
   that way before; no `.xlsb` ever was.

3. **A number is rendered once, as ADR 0104 decision 7 says.** `BrtCellReal`, `BrtFmlaNum` and
   `BrtCellRk` go through `doubleText` and `rkText`. An RK's ×1/100 is a decimal shift of the
   rendered digits. Nothing computes with the double.
4. **A sheet is read as it inflates (ADR 0106).** The part's bytes are streamed and cut into
   records as they arrive. A record cut by a piece boundary is read whole once the next piece
   comes.
   - A record the reader does not read is skipped by its size and never held.
   - A record it reads is held only up to 4 MiB. The largest it reads is a string cell or shared
     string: 32,767 UTF-16 characters with their runs and phonetic guide, an order of magnitude
     less. A larger size is a header that cannot be true, and the part is unreadable.
   - The shared strings and styles are read the same way, and are kept as the strings and
     format ids they hold, never as their bytes.
5. **The facts recorded are the ones the other readers record**, from the records [MS-XLSB]
   defines for them:
   - each sheet's name, tab order and state, from `BrtBundleSh`;
   - the 1904 epoch, from `BrtWbProp.f1904`;
   - each cell, placed under the row its `BrtRowHdr` opened;
   - a hidden row, from `BrtRowHdr.fDyZero`;
   - the declared range, from `BrtWsDim`;
   - merged ranges, from `BrtMergeCell`;
   - each cell's number format: the cell format `iStyleRef` names, in the list after
     `BrtBeginCellXFs`, then its built-in or `BrtFmt` code.

   A sheet with no part of its own that is very hidden is a VBA module (§2.4.316). It is not
   listed, as BIFF8's module sheets are not.

6. **What cannot be read exactly is refused, never guessed.**
   - A workbook part that does not begin with `BrtBeginBook` is refused whole as
     `xlsb-unreadable`. So is one that ends inside a record, or one with a record shorter than
     its layout. A shared string table or styles part that the workbook declares and that cannot
     be read to its end is refused the same way. Without the strings every text cell would read as
     missing, and without the styles every date would read as a bare number.
   - A sheet that breaks off ends `sheet-unreadable`. The rows before the break are kept. The
     row being gathered at the break is not kept, because a row is known whole only when the
     next row header or the end of the part arrives.
   - Rows out of order, cells out of order, a row past 1,048,576, a column past XFD and a cell
     over 32,767 characters stop the sheet. They use the same reasons as the other readers.
   - A cell before any row header has no row, and stops the sheet as `sheet-unreadable`.
   - `formula-uncached` cannot arise. Every `BrtFmla*` record carries its cached result before
     its formula.
7. **A package whose content-types part names the binary workbook is read as one under any
   label.** That covers a spreadsheet label, `application/octet-stream`, and a zip label, as an
   `.xlsx` already is (ADR 0108 decision 5). Its main part's type is recognised both as Excel
   writes it (`…sheet.binary.macroEnabled.main`) and as [MS-XLSB] §2.1.7.61 states it
   (`application/vnd.ms-excel.main`).
8. **Refusals already recorded are read again.** `CURRENT_READER_VERSION` goes to 11. That
   re-offers every `xlsb-unsupported` refusal, and every `.xlsb` refused
   `unsupported-content-type` under a generic label. The UI keeps words for `xlsb-unsupported`
   until no row carries it, and says that the next run reads such a file again.

## Consequences

- A model reads an `.xlsb` from `source('undercroft', 'document_rows')` exactly as it reads an
  `.xlsx`. The file-format catalogue's reading level for `.xlsb` is `table`.
- An empty sheet's declared range reads `A1:A1`. [MS-XLSB] writes an all-zero `BrtWsDim` for a
  sheet with no cells, and the zeros are recorded as stated.
- `zip.ts` gains `streamZipBytes`, and `streamZipText` is it decoded. That leaves one inflating
  stream for both kinds of part.
- An `.xlsb` read before this ADR has no rows to backfill: every one was refused, so the version
  bump reaches them.

## Options rejected

- **A converter to `.xlsx`** (LibreOffice, `ssconvert`). ADR 0028 rejected this as a container's
  worth of dependency, and it would put a second parser beside the one search uses.
- **An npm workbook library.** It is a supply-chain surface in the process that holds
  `UNDERCROFT_SECRET_KEY`, for a grammar that fits in a few hundred lines. It would also parse
  numbers its own way, so ADR 0104 decision 7 would depend on someone else's float handling.
- **Holding a sheet part whole.** It is simpler, but it brings back the 32 MiB ceiling that
  ADR 0106 removed for `.xlsx`, on the format people choose for their largest workbooks.
- **A second relationship walker beside `workbookPackage.ts`.** Two copies of how a target is
  resolved would drift, and one of them would learn about `..` or `TargetMode` without the other.
- **Reading a styles part that breaks off as "General everywhere".** That reads a date as a bare
  number and records no format, which looks complete and is not.

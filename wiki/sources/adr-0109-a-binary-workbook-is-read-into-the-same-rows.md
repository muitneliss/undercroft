---
title: ADR 0109 A Binary Workbook Is Read into the Same Rows
type: source
date: 2026-10-05
tags: []
source: docs/adr/0109-a-binary-workbook-is-read-into-the-same-rows.md
source_path: docs/adr/0109-a-binary-workbook-is-read-into-the-same-rows.md
source_hash: a3bdc57c51e5c96a61cedbebc66b53f648bf49f4e1f50373992db2271deea336
ingested: 2026-10-05
---

# ADR 0109 A Binary Workbook Is Read into the Same Rows

An Excel binary workbook (`.xlsb`, BIFF12) is now read in process into the same sheets of rows an `.xlsx` and an `.xls` give, under method `xlsb` and container `xlsb`; until now it was refused `xlsb-unsupported`. It extends [[ADR 0104 Every Workbook Is Landed as Rows]] decision 7 (a binary number rendered once, never computed with) to BIFF12, follows [[ADR 0106 A Sheet Is Read as It Inflates]] for its sheet parts, and [[ADR 0108 An Archive Is Read into the Documents It Holds]] decision 5 for packages under a generic label.

Decision: parts are found through the package's relationships exactly as for an `.xlsx`; the rules for following a relationship (case-insensitive names, external targets excluded, targets resolved against their part, types matched on their last segment) move into one module, `opcPackage.ts`, shared by both workbook readers, and a sheet's kind comes from its relationship type through the same table. No conventional-name fallback, since no `.xlsb` was ever read that way. `BrtCellReal`, `BrtFmlaNum` and `BrtCellRk` go through `biff8Values.ts`' `doubleText` and `rkText`, so an RK's ×1/100 is a decimal shift. A part's bytes are streamed (`streamZipBytes`) and cut into records as they inflate: a record split across pieces is read whole, records not read are skipped by size and never held, and a record that is read is held only up to 4 MiB. Facts recorded: sheet name, tab order and state (`BrtBundleSh`), the 1904 epoch (`BrtWbProp.f1904`), cells under the row their `BrtRowHdr` opened, hidden rows (`fDyZero`), the declared range (`BrtWsDim`), merged ranges (`BrtMergeCell`), and each cell's number format via the cell-format list after `BrtBeginCellXFs`. A very hidden sheet with no part is a VBA module and is not listed.

Refusals: a workbook part that does not begin with `BrtBeginBook`, ends inside a record or holds a record shorter than its layout, or a declared shared string table or styles part that cannot be read whole, refuses the workbook as `xlsb-unreadable`. A sheet that breaks off ends `sheet-unreadable` with the rows before it kept; the row being gathered is dropped because a row is only known whole at the next row header. The other readers' row-level reasons apply. `formula-uncached` cannot arise, because every `BrtFmla*` record carries its cached result. A package whose content-types part names the binary workbook (Excel's spelling or [MS-XLSB]'s `application/vnd.ms-excel.main`) is read under any label. `CURRENT_READER_VERSION` goes to 11 to re-offer every `xlsb-unsupported` refusal. An empty sheet's declared range reads `A1:A1`, as the spec's all-zero `BrtWsDim` states.

Rejected: a converter to `.xlsx` (LibreOffice, `ssconvert`), an npm workbook library, holding a sheet part whole, a second relationship walker beside `workbookPackage.ts`, and reading a broken styles part as "General everywhere".

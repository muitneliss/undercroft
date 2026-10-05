---
title: ADR 0106 A Sheet Is Read as It Inflates
type: source
date: 2026-10-05
tags: []
source: docs/adr/0106-a-sheet-is-read-as-it-inflates.md
source_path: docs/adr/0106-a-sheet-is-read-as-it-inflates.md
source_hash: 0790890c12300aff2cef07cd38e45d1338d3b87aafdad1af2a0a0440611fc77c
ingested: 2026-10-05
---

# ADR 0106 A Sheet Is Read as It Inflates

A workbook's worksheet and its shared string table are now read as their zip members inflate, never held whole, superseding the one clause of [[ADR 0104 Every Workbook Is Landed as Rows]] that kept the 32 MiB ceiling on one inflated member until this work. `zip.ts`'s `streamZipText` inflates through `node:zlib`'s streaming inflater and hands UTF-8 text over in pieces; `sheetScan.ts` appends each piece to what is left of the last, reads every whole `<row>` and carries only the partial row forward, reading `<dimension>` before `<sheetData>` and `<mergeCells>` after it. A sheet's rows are streamed afresh each time they are asked for -- once for the text and facts, once for the write -- and never collected. The shared strings are kept, their XML is not; a table that stops part-way refuses the workbook (`xlsx-unreadable`) rather than reading every text cell as `shared-string-missing`.

The stream's ceiling is a bound on work, not memory: 2 GiB inflated per member (`MAX_STREAMED_BYTES`), past which the sheet stops with `sheet-too-large`; a part that breaks part-way stops with `sheet-unreadable`, rows before the stop held. Other parts (workbook, relationships, styles, a `.docx`) stay whole under 32 MiB. Reader generation 7 re-offers every `xlsx-unreadable` refusal, reaching the large workbooks already landed (most of `tai-001`'s 41 refused digests were 5 MB or more).

Measured under `bun --smol`: 100,000 rows × 20 columns (91.2 MiB of sheet XML, 7.0 MiB `.xlsx`) read in about 1 s per pass with 7 MiB peak above baseline; 400,000 rows (377.9 MiB XML) in about 4 s per pass with 6 MiB -- four times the sheet, the same memory, about 10 µs a row per pass. Postgres insert rate is not measured offline. Rejected: raising `MAX_MEMBER_BYTES`, inflating to a scratch file, DuckDB or another parsing dependency (the in-house reader meets the condition ADR 0104 set), and keeping the first pass's rows for the write.

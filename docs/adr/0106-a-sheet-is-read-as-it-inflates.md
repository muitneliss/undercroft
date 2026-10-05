# 106. A sheet is read as it inflates

- Status: Accepted
- Date: 2026-10-05
- Supersedes: [ADR 0104](0104-every-workbook-is-landed-as-rows.md) decision 11 on one point only --
  "The 32 MiB ceiling on one inflated member stands until the large-workbook work replaces
  whole-member inflation with a bounded stream". This is that work. Everything else in ADR 0104
  stands, and so does ADR 0028's in-process reader.

## Context

`zip.ts` inflates a member whole, into one buffer and then one string, and refuses one past
`MAX_MEMBER_BYTES` (32 MiB). That ceiling is a memory bound: past it, a part would sit in the
worker's heap two or three times over, in a process held to a 3 GiB cgroup it cannot see
(`deploy/Dockerfile.worker`). For every part of a workbook but two it is generous. The two are a
worksheet and the shared string table, and both grow with the data.

On `tai-001`, 51 workbooks were refused `xlsx-unreadable`, and 35 of their 41 digests are 5 MB
or more. A 7 MB `.xlsx` of a 100,000-row ledger holds 91 MiB of sheet XML. Raising the ceiling
would trade a refusal for a run that holds several hundred megabytes at once beside whatever
else the worker is doing, which is the failure the ceiling exists to prevent.

## Decision

1. **A worksheet is streamed, never held whole.** `streamZipText` inflates a member through
   `node:zlib`'s streaming inflater and hands its UTF-8 text over in pieces. `sheetScan.ts`
   appends each piece to what is left of the last one, reads every whole `<row>` in it, and
   carries only the partial row at its end into the next. `<dimension>` is read from what comes
   before `<sheetData>`, and `<mergeCells>` from what comes after. A sheet's rows are streamed
   afresh each time they are asked for: once for the text and the sheet's facts, and once more
   when the rows are written. They are never collected.
2. **So is the shared string table.** It is the one part a cell points into by index, so its
   strings are kept. Its XML is not: each `<si>` is read as it arrives. A table that stops
   part-way refuses the workbook (`xlsx-unreadable`). Reading on without it would turn every
   text cell into a `shared-string-missing` fault, a workbook with its words gone that passes
   for a read.
3. **A stream has a ceiling on work, not memory: 2 GiB inflated per member**
   (`MAX_STREAMED_BYTES`). Past it the stream stops and says so, and that sheet is incomplete
   with `sheet-too-large`, with the rows before the stop held. A part that breaks part-way is
   `sheet-unreadable` in the same way. 2 GiB is several times the XML of a sheet at Excel's own
   row limit, so the ceiling bounds what a zip bomb can cost in seconds of inflating and does
   not limit a real workbook.
4. **Every other part stays whole**, under the 32 MiB ceiling: the workbook part, the
   relationships and the styles. Each is small and read once. A `.docx` stays whole too; its
   text is capped at a million characters anyway.
5. **Reader generation 7** re-offers every `xlsx-unreadable` refusal, which is what reaches the
   large workbooks already landed.

## Measured

`bun --smol`, Apple Silicon. Each workbook is one sheet of 20 columns, alternating inline text
and decimals. The figure is peak RSS above the baseline taken after the workbook's bytes were
built and the heap collected, sampled every 5 ms while the text pass and then the rows pass ran.

| Rows    | Sheet XML | `.xlsx`  | Text pass | Rows pass | Peak above baseline |
| ------- | --------- | -------- | --------- | --------- | ------------------- |
| 100,000 | 91.2 MiB  | 7.0 MiB  | 0.99 s    | 1.04 s    | 7 MiB               |
| 400,000 | 377.9 MiB | 28.2 MiB | 3.85 s    | 4.18 s    | 6 MiB               |

Four times the sheet, the same memory: what a read holds is one piece and one row. Each pass
costs about 10 µs a row. A read inflates the sheet twice, and that time is the price of never
holding it.

Not measured here: the write to Postgres, which sends rows in batches of 1,000 (`ROW_BATCH`).
PGlite in the offline gate is no measure of a real server's insert rate. Measure it on the
server when a large tenant's backfill runs, from the run's duration.

## Consequences

- A workbook of any size Excel can save is read whole, up to Excel's own limits (ADR 0104
  decision 11). The 32 MiB line in the file-formats reference becomes 2 GiB, with its reason
  renamed `sheet-too-large`.
- Reading a workbook is asynchronous end to end: `readWorkbook`, a sheet's `rows()` and the row
  writer are streams. The text pass and the rows pass each pay the inflate.
- A workbook whose shared string table is corrupt or too large is refused whole, as before this
  work. Only a sheet can now be partly read.

## Options rejected

- **Raising `MAX_MEMBER_BYTES`.** It would hold a large sheet two or three times over, in a
  process that cannot see the limit it is killed at.
- **Inflating to a scratch file and scanning that.** It writes a sheet's full XML to the
  worker's disk, the same size again, for a scan that needs one row at a time.
- **DuckDB, or any parsing dependency** (ADR 0104, Options rejected). Measured, the in-house
  reader holds a 378 MiB sheet in 6 MiB, which is the condition ADR 0104 set for reopening
  that question, and it is met.
- **Keeping a sheet's rows from the first pass for the write.** It would make the write cost no
  inflate, at the price of holding every row, which is the memory this ADR exists to remove.

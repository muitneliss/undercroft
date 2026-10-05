---
title: ADR 0107 A Delimited File Is Read into Rows by the Grammar Its Type Names
type: source
date: 2026-10-05
tags: []
source: >-
  docs/adr/0107-a-delimited-file-is-read-into-rows-by-the-grammar-its-type-names.md
source_path: >-
  docs/adr/0107-a-delimited-file-is-read-into-rows-by-the-grammar-its-type-names.md
source_hash: 34355def71967d444a52464af3ce4ecdefbc0d6b2baca01ab314b0a00fdb2df9
ingested: 2026-10-05
---

# ADR 0107 A Delimited File Is Read into Rows by the Grammar Its Type Names

A CSV (and a TSV) is now read twice from one decode: its text stays the file in `raw.document_text` under method `txt`, and its records become rows in `raw.document_sheets` / `raw.document_rows` as one unnamed sheet (`sheet_name_reason: delimited-text-has-no-sheets`, container `csv` or `tsv`), through the tables, writer and backfill of [[ADR 0104 Every Workbook Is Landed as Rows]]. It supersedes the unrecorded reading, kept in `extractText.ts` and the file-formats reference, that a CSV is not split because that would mean guessing a delimiter, quoting and encoding: `text/csv` is RFC 4180 (comma, line break, double-quote quoting with doubled quotes) and `text/tab-separated-values` is IANA's (tab, line break, no quoting), and the encoding is decided by the byte-order mark as `readPlainText` already does. 887 CSVs on `tai-001` were one cell of text each.

Decision: the grammar is the one the declared type names, never a delimiter sniffed from content, so a semicolon file sent as `text/csv` lands as one column a model may split. The grammar bends only where no reading is lost (CRLF, LF or lone CR; a quote inside an unquoted field is a character). A closing quote followed by more text, or a quote never closed, stops the sheet with `csv-malformed`, rows before it kept; the text stays the whole file, so `truncated` is about text alone. Rows are numbered as records are, a blank line keeping its number; values stay strings; limits are ADR 0104's (1,048,576 rows, 16,384 columns as `columns-limit`, 32,767 characters). The backfill owes rows to any text read from a CSV or TSV document whatever its method, and does not rewrite its text. Rejected: delimiter sniffing, rendering the text from the rows, refusing a malformed file whole.

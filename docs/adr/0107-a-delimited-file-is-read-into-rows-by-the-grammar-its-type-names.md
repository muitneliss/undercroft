# 107. A delimited file is read into rows by the grammar its type names

- Status: Accepted
- Date: 2026-10-05
- Supersedes: the reading recorded beside `text/csv` in `extractText.ts`'s reader table and in
  `docs/reference/file-formats.md` -- that a CSV "is not split into rows, because doing that
  would mean guessing a delimiter, a quoting style and an encoding that the file does not
  state". No ADR held that reading; this one replaces it.
- Extends: [ADR 0104](0104-every-workbook-is-landed-as-rows.md) to delimited text files.

## Context

A CSV reaches a dbt model as one cell of text, and the model splits it. On `tai-001` that is 887
documents. The reason recorded for not splitting it was that the file does not state its
delimiter, quoting or encoding, so splitting would mean guessing.

That is true of a file, and not of a file with a media type. `text/csv` is registered by
RFC 4180, which fixes the grammar:

- a comma between fields;
- a line break between records;
- a field may be wrapped in double quotes, and a quote inside a quoted field is written twice.

`text/tab-separated-values` is registered by IANA with its own grammar:

- a tab between fields;
- a line break between records;
- no quoting, because a field may hold neither a tab nor a line break.

The encoding is what `readPlainText` already decides by the file's byte-order mark (#218), with
no guess either. What would be a guess is _sniffing_ a delimiter from the content, and that is
not proposed.

## Decision

1. **A delimited file is read twice from one decode: as text, and as rows.**
   - `raw.document_text` keeps the file's text, exactly as before, under method `txt`, so search
     finds what the sender wrote.
   - Its records are written to `raw.document_sheets` and `raw.document_rows` as one sheet. That
     sheet has `container` `csv` or `tsv`, no name (`sheet_name_reason`
     `delimited-text-has-no-sheets`), and no 1904 epoch.
   - These are the same tables, the same writer and the same backfill as ADR 0104's workbooks.
2. **The grammar is the one the declared type names, never a delimiter guessed from the
   content.**
   - `text/csv` is read as RFC 4180. A semicolon-separated file sent as `text/csv` is therefore
     one field per record, which is what its bytes say under that grammar; a model that knows
     better splits it.
   - `text/tab-separated-values` is read as IANA's TSV, where a quote is only a character.
3. **The grammar is bent only where no reading is lost, as every spreadsheet bends it.**
   - A record may end in CRLF, LF or a lone CR.
   - A double quote inside an unquoted field is that character.
4. **A record the grammar has no reading for stops the sheet.** That is a closing quote followed
   by anything but a separator or a line break, or a quoted field the file never closes. The rows
   before it are kept, and the sheet says `complete = false` with reason `csv-malformed`. The text
   is still the whole file, so `truncated` stays about the text alone (ADR 0104 decision 10).
5. **Rows are numbered as the file's records are.** A blank line is a record with nothing in it,
   so the row after it keeps its number. Values are the strings the file holds, and `1234.10` is
   those seven characters (`money.md`). The limits are ADR 0104's: 1,048,576 rows, 16,384
   columns (`columns-limit`), 32,767 characters a field.
6. **Delimited files already read get their rows without a hand edit.** The backfill owes rows
   to any text read from a `text/csv` or `text/tab-separated-values` document, whatever its
   method. Without that, a CSV's `txt` method would hide it from ADR 0104's backlog, which keys on
   workbook methods. The text is not rewritten: it was already the file.

## Consequences

- A model reads a CSV with `source('undercroft', 'document_rows')`, as it reads a workbook, and
  types columns with `parse_amount` and the date macros.
- A CSV written by a European-locale Excel (semicolons, decimal commas) lands as one column. That
  is visible in the rows, not hidden, and `split_part` in a model is the answer the person can
  choose.
- An `.csv` sent as `application/octet-stream` is not read as CSV: the label says nothing, and
  the name is not consulted at read time (ADR 0104 decision 5).

## Options rejected

- **Sniffing the delimiter** (comma, semicolon, tab, pipe) from the first lines. It is right on
  most files and silently wrong on the rest. A wrong split puts an amount in the wrong column,
  which is the failure ADR 0104 opened by fixing.
- **Rendering the text from the rows**, as a workbook's text is. It would change the text of 887
  documents for no reader's benefit: a CSV's text is already the clearest rendering of it.
- **Refusing a malformed file whole.** It would lose every exact row before the fault, where
  stopping the sheet keeps them and says where it stopped.

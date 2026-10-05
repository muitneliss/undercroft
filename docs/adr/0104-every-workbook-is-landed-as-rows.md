# 104. Every workbook is landed as rows

- Status: Accepted
- Date: 2026-10-05
- Supersedes: [ADR 0028](0028-a-workbook-is-read-in-process-and-extract-is-scheduled-by-backlog.md)
  on one point only -- "Sheet **names** are not included". Everything else in ADR 0028 stands,
  the in-process reader above all.
- Answers: issue #385, "a model can read the whole text of a large spreadsheet"
- Extends: [ADR 0024](0024-extracted-text-is-readable-by-dbt.md)'s exception in `pii.md` to two
  more tables, on the same terms

## Context

A workbook reaches a dbt model today as one cell of text: `raw.document_text.text`, the sheets
rendered as tab-separated lines and cut at 1,000,000 characters (`MAX_TEXT_CHARS`). A model that
wants rows splits that text itself. Four things go wrong, and the first is a defect rather than a
limit.

1. **A row's cells slide left.** Excel writes no element for an empty cell. The reader joined a
   row's `<c>` elements in document order, so a row holding A and C put C's value in B's column.
   An amount read under the wrong heading is the failure `money.md` is written against, arriving
   through layout instead of arithmetic.
2. **A long ledger is cut.** The ceiling is a decision about Postgres (`extractText.ts`), and
   every row after it is unreadable to a model, which can only mark the file partial and leave
   its totals unchecked (#385).
3. **A model splits text a platform could have split exactly.** Every tenant re-implements
   `regexp_split_to_table` over `\n` and `\t`, with no row numbers, no sheet names and no way to
   tell an Excel error from a word.
4. **Many workbooks never become text at all.** Measured on `tai-001` on 2026-10-05, live
   documents only, counts without names:

| What                                                                         | Documents (digests) |
| ---------------------------------------------------------------------------- | ------------------- |
| `.xlsx` / `.xlsm` read whole                                                 | ~4,240 (3,205)      |
| read, but cut at 1,000,000 characters                                        | 47 (43)             |
| refused `xlsx-unreadable`; 35 of the 41 digests are ≥ 5 MB                   | 51 (41)             |
| `.xls` refused `legacy-xls-unsupported`                                      | 364 (314)           |
| Gmail `.xlsx` / `.xlsm` sent as `application/octet-stream`, **never landed** | 132 parts           |

The last row is two gaps. The first is consent, and it is deliberate: `allowsFacts`
(`packages/contracts/src/fileMatching.ts`) lets a generic type through only for an extension
the admin chose as an extension (ADR 0048). So the curated "Excel (.xlsx)" choice does not
admit an `.xlsx` that Gmail could only call `application/octet-stream`. The second is a defect:
had the admin chosen `.xlsx`, `landedType` would still file the file as octet-stream, because
only `.oa` has a `landsAs`, and the reader would refuse it.

## Decision

1. **A workbook is landed as rows, beside its text.** Two projections join `raw.document_text` in
   schema `raw`, rebuilt by the extract verb like it, and never a durable layer (CLAUDE.md
   rule 1):
   - `raw.document_sheets`: one row per sheet of a workbook. It holds the sheet's index, its
     exact name or NULL, its kind (worksheet, chartsheet, dialogsheet, macrosheet), its state
     (visible, hidden, veryHidden), the container it came from, the workbook's `date1904` flag,
     its declared dimension, its merged ranges, its row count, and `complete` with a `reason`
     when the read stopped short.
   - `raw.document_rows`: one row per non-empty row. It holds Excel's own row number, whether
     the row is hidden, and three sparse jsonb maps keyed by column letter. `cells` holds the
     strings the file stores. `formats` holds the number-format code of each cell whose format
     is not General. `faults` holds what is not a value: an Excel error such as `#REF!`, or
     `formula-uncached` for a formula written without its result.

   **Keyed by content digest** (`tenant_id, sha256`), not by document. `raw.documents` is
   provenance-addressed, so one ledger quoted in ten messages and filed in Drive is one set of
   rows; a model joins `raw.documents.sha256` to reach it. `document_text` stays per document.

2. **The platform records facts and interprets nothing.**
   - No header row is chosen, and no column is named or typed.
   - No date is rendered: a date stays its serial, beside the `date1904` flag and its format
     code.
   - No merged range is filled, and no hidden row is dropped.
   - A built-in number format whose code depends on the reader's locale is recorded as
     `builtin:<id>`, never expanded to a code the file did not state.

   The tenant's model chooses all of these, with `parse_amount` and two new platform macros,
   `excel_serial_date` and `excel_serial_timestamp`, which convert a serial exactly when asked
   to. This is CLAUDE.md's "ships no business schema" and rule 2, applied to the most
   heterogeneous input the platform has.

3. **A cell is placed by its reference.** A cell's `r` attribute names its column. A cell without
   one takes the column after the one before it, which is what ECMA-376 Part 1 §18.3.1.4 says it
   means. A row whose cells do not run left to right, or that names a column past XFD, is not
   laid out by a guess: the workbook is refused. This applies to the text as much as to the rows.

4. **Sheet names are read exactly.** The reader follows the package's relationships
   (`_rels/.rels`, then the workbook part's own `.rels`) to find the workbook, each sheet, the
   shared strings and the styles. It accepts both the Transitional and the Strict relationship
   namespaces. A name whose relationship does not resolve is NULL with a reason. This is the walk
   ADR 0028 declined to make by convention, and it is what lets a producer that names its parts
   differently from Excel be read at all.

5. **The container confirms the reader.** The declared type decides only whether a document is
   a spreadsheet: the spreadsheet family, plus `application/octet-stream` and the zip types.
   Inside that set, the bytes decide which reader opens it:
   - a zip signature leads to `[Content_Types].xml`, which names the workbook part's own type;
   - a CFB signature leads to its root streams: `Workbook` for BIFF8, `Book` for BIFF5,
     `EncryptionInfo` with `EncryptedPackage` for a password-protected OOXML file.

   An `.xlsx` declared `application/vnd.ms-excel` is therefore read. A `.docx` declared as a
   spreadsheet is refused by name, never read as one. Every refusal on this path has its own
   name: `workbook-password-protected`, `workbook-not-a-workbook`, `xlsb-unsupported`,
   `xls-biff5-unsupported`. This reads a fact from the bytes. The file-formats rule that an
   extension never overrides a MIME type is unchanged: no extension is consulted when a document
   is read.

6. **A chosen spreadsheet extension lands as a workbook, and consent is not widened.** When an
   admin chooses `.xlsx`, `.xlsm`, `.xls`, `.xltx` or `.xltm` as an extension, an
   `application/octet-stream` file of that name is filed under its spreadsheet type (`landsAs`),
   so it reaches the workbook reader. Today it would land as octet-stream and be refused even
   though the admin asked for it. Choosing the curated MIME format still does **not** admit an
   octet-stream file by its name. That is [ADR 0048](0048-a-file-is-recognised-by-its-type-first-and-a-signed-record-is-verified-before-it-is-read.md)'s
   rule, and widening it would widen every recorded consent on deploy. The 132 parts on
   `tai-001` therefore land once the admin adds those extensions. ADR 0076's left-behind list
   then re-reads exactly the held messages that carry such a part, once each, with no backfill
   step.

7. **A binary workbook's number is rendered once, and never computed with.** BIFF8 stores a
   number as an IEEE-754 double (NUMBER), or as an RK that is an integer or a double, optionally
   ×1/100. The double **is** the file's value; the platform did not create it. The reader renders
   it once, to the shortest decimal string that round-trips (ECMAScript `Number::toString`). That
   is the string an `.xlsx` would have stored for the same cell. An RK's ×1/100 is applied
   decimally, with `big.js` on the rendered string, never as a float division. This is the one
   place a `number` holds a value that may be money. If the `money` plugin fires on that read,
   the suppression names the plugin (`lint/plugin/money`) on that line alone, per `suppressions.md`.

8. **A re-read never removes what is held.** A digest's sheets and rows are replaced in one
   transaction, and only after its parse succeeded. If the parse fails, nothing is written, and
   the rows already held stay selectable. This is the 2,602-document rule in
   `apps/worker/src/repos/documentText.ts`, applied to rows.

9. **Rows reach workbooks already landed without a hand edit.** `ROWS_VERSION`, beside
   `CURRENT_READER_VERSION`, is stamped on each sheet. A backlog that reads bytes offers every
   live spreadsheet-family document whose digest has no sheets, or sheets of an older version.
   That pass also rewrites the document's text, under decision 8's condition, which is how
   decision 3's fix reaches text read before it. A digest no live document holds any more has
   its sheets deleted, and the run counts them.

10. **Completeness has one flag per meaning (#385).** A sheet's completeness is
    `document_sheets.complete`. `document_text.truncated` keeps describing the search text only,
    and `MAX_TEXT_CHARS` is not raised. A model reads every row of a workbook whose text is far
    over 1,000,000 characters, and the workbook's text is still marked truncated, truthfully.

11. **Limits are Excel's own, stated in the file-formats reference:**
    - 1,048,576 rows per sheet (65,536 for BIFF8);
    - 16,384 columns;
    - 32,767 characters per cell;
    - 256 sheets per workbook.

    A sheet stopped by a limit says so (`complete = false`, `reason`). The 32 MiB ceiling on one
    inflated member stands until the large-workbook work replaces whole-member inflation with a
    bounded stream; that change records its measurement in its own ADR.

12. **Who reads what.**
    - `undercroft_worker` writes both tables.
    - `undercroft_dbt` and every tenant's dbt role may select both, granted in the one list in
      `repeatable/010_provision_tenant.sql`, under the same row-level policy as
      `raw.document_text`.
    - `undercroft_app` may select `document_sheets` without `sheet_name`, and nothing in
      `document_rows`. A sheet name and a cell are content a person wrote, and `pii.md`'s line
      is that the control plane never reads content.
    - `undercroft_bi` reads nothing in `raw`, as before.
    - Both tables are declared dbt sources, so `modelCheck` and `modelLineage` see them.

The work ships in stages. Each stage leaves the gate green and changes nothing a later stage
relies on. The order was set by the measurement above:

1. the reference fix (decision 3);
2. the structured reader (decision 4);
3. the tables (decisions 1 and 12);
4. the backfill (decisions 8 and 9);
5. the dbt surface (decision 2's macros);
6. large workbooks;
7. arrival (decisions 5 and 6);
8. BIFF8 (decision 7).

## Consequences

- A model selects `cells ->> 'F'` from `source('undercroft', 'document_rows')` instead of
  splitting text. Header, title rows and totals are its call, and the published
  `undercroft-model-builder` skill teaches the four shapes client workbooks actually take.
- Any connector that lands a spreadsheet gets rows, including one not written yet: extraction is
  keyed by content type, never by source.
- Text and rows come from one parse, so the search index and a model cannot disagree about what a
  workbook says.
- A tenant's `raw` schema grows by roughly one row per spreadsheet row. On `tai-001` that is the
  rows of ~3,600 workbook digests, most under 1 MB. It is a projection, and dropping it costs one
  extract pass.
- A workbook that was read before the reference fix keeps its slid text until the backfill pass
  reaches it.
- The control plane can count a document's sheets but cannot name them. A Lake-console view of a
  sheet would read through the tenant's dbt login inside the worker, as search excerpts do
  (ADR 0026); it is not part of this decision.

## Options rejected

- **A platform macro that splits `document_text`.** It costs no migration, but it keeps the
  1,000,000-character ceiling, the slid columns and the missing sheet names, and it moves the
  split into every model's run instead of doing it once.
- **One row per cell.** It is the most general shape, but 50,000 rows × 10 columns is 500,000
  rows, which every model pivots back before it can read a line. Sparse jsonb keyed by letter
  keeps a row a row and blanks blank.
- **A dense `text[]` per row.** Every model would translate column letters to indexes, an
  off-by-one in every query, and a row's width would have to be invented for a sparse row.
- **A typed table per sheet, with inferred column types** (the shape of a generic ingestion
  plan). A header guess and a 99.5 % type threshold are guesses that read as facts downstream.
  They are also a business schema: the tenant's dbt project is where a typed table belongs.
- **DuckDB's `read_xlsx`.** It returns a headed, inferred table. Its documentation promises
  neither row numbers, column letters, a sheet listing nor the 1904 flag. It loads its `excel`
  extension from the network unless one is bundled, and it does not read `.xls`. Embedded, it
  would run native code over untrusted files in the one process holding `UNDERCROFT_SECRET_KEY`
  (ADR 0028's objection to a parsing dependency, with a larger surface), and it would be a second
  parser beside the one search uses. If the in-house reader cannot meet the limits above, the
  alternative to weigh is DuckDB in a container of its own with no secrets, under a new ADR.
- **Raising `MAX_TEXT_CHARS` for #385.** It answers one workbook size with another and still cuts
  the next ledger. Rows remove the ceiling for the question #385 asks, which is reading every row.
- **Rows keyed by document, like `document_text`.** It is simpler to join, but it stores a quoted
  ledger once per message that quotes it. `raw.documents` already carries the digest a model
  needs to join on.
- **Letting the curated "Excel (.xlsx)" choice admit octet-stream `*.xlsx` files.** It would
  have landed the 132 parts with no action from anyone. It would also widen every recorded
  Gmail and Drive scope on deploy, and ADR 0048 refuses exactly that: a name becomes a match
  only where an admin chose the name.
- **Filling merged cells or dropping hidden rows on the platform's side.** Each is right for some
  workbooks and wrong for others. Only the model knows which kind it is reading, so the platform
  records the range and the flag, and acts on neither.

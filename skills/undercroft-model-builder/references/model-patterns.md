# Model patterns

What a model can read, the shapes most models take, and how to turn a query somebody already
has into a model. `models.reference` returns the source definition and the macros for the
server you are on; when it disagrees with this page, it is right.

## What a model reads

- **The raw lake**, through dbt's `source()`:
  - `{{ source('undercroft', 'records') }}` -- every source's records, one row per record.
    Its columns: `tenant_id`, `source`, `entity`, `source_record_id`, `payload` (jsonb, the
    record as the source sent it), `source_updated_at`, `observed_at`, `loaded_at` and
    `deleted_at` (set when the source deleted it).
  - `{{ source('undercroft', 'documents') }}` -- the catalogue of files and attachments, one
    row each. The bytes are not in Postgres.
  - `{{ source('undercroft', 'document_sheets') }}` and `{{ source('undercroft', 'document_rows') }}`
    -- every sheet of every landed workbook, and its rows, keyed by the digest of the file's
    bytes (`documents.sha256`). `{{ source('undercroft', 'document_rows_refusal') }}` says why a
    workbook has no rows. See "A workbook's rows" below.
- **Each document's kind**, as `raw.document_kinds`, by its name: it is not one of the declared
  sources, so a model names it directly, the one raw relation it does. One row per live
  document that has been classified, keyed by `source` and `document_id` like `documents`.
  `accepted_kind` is the kind confirmed under the customer's current catalogue, else NULL;
  `last_accepted_kind` keeps the kind an earlier catalogue confirmed until the current one has
  answered, and `current` says which of the two a row holds. The `undercroft` skill's page on
  document kinds says what each column means.
- **Other models**, through dbt's `ref()`: `{{ ref('stg_hubspot_deals') }}`.

The project's own login reads only its own customer's rows, so a model never filters on
`tenant_id` to stay in bounds. Apart from `raw.document_kinds`, never name a raw table or
another model's table directly
(`raw.records`, `analytics_case_0042.stg_deals`, or a bare `stg_deals`): `models.check`
refuses it, because dbt would not know what the model depends on.

A document's kind, for a table a dashboard can read. A document nobody has classified yet
keeps a NULL kind, which is what it is -- never `'other'`, never a guess:

```sql
select
    d.source,
    d.document_id,
    d.content_type,
    k.last_accepted_kind as kind,
    k.current as kind_is_current,
    k.version as kind_version
from {{ source('undercroft', 'documents') }} as d
left join raw.document_kinds as k
    on k.source = d.source
    and k.document_id = d.document_id
where d.deleted_at is null
```

A model is one query. No `;`, no `insert`, `update` or `create`: dbt makes the table from the
query's result.

## Staging: one entity, typed columns

The pattern most models start as. Filter records to one source and entity, leave deleted
records out, and pull typed columns out of the payload.

```sql
with deals as (
    select
        source_record_id                                   as deal_id,
        payload -> 'properties' ->> 'dealname'             as deal_name,
        payload -> 'properties' ->> 'dealstage'            as stage,
        {{ parse_amount("payload -> 'properties'", 'amount') }} as amount,
        (payload -> 'properties' ->> 'closedate')::timestamptz as closed_at,
        source_updated_at
    from {{ source('undercroft', 'records') }}
    where source = 'hubspot'
      and entity = 'deals'
      and deleted_at is null
)

select * from deals
```

- `->` keeps jsonb; `->>` gives text. Cast text only to a type every sampled value fits.
- An amount goes through the amount macro, which gives a fixed-precision number or `NULL`,
  never a float and never `0` for something unreadable.
- `source_updated_at` is when the source changed the record; `NULL` means the source did
  not say, and it stays `NULL`.

## Letters from every mailbox

Gmail mailboxes land as `gmail` and `gmail.<account key>`, and the same letter can arrive in
several. The `gmail_letters()` macro folds them into one row per letter:

```sql
select
    letter_key,
    message_time,
    copies,
    headers_conflict
from {{ gmail_letters() }} l
```

## Where a Drive file sits

A Drive source lands each file as a `files` record and each folder its walk listed as a
`folders` record. Both name their folder by id in `payload -> 'parents'`, and a picked folder
names none. No folder name reaches a model; match an id to its folder in the source's folder
browse. Read a file's location from `records`, never from `documents`: a document's
`metadata` says where the file was when its bytes landed, and a move does not land them again.

A recursive query walks from each file up to the pick, one row per folder above it:

```sql
with recursive folders as (
    select source_record_id as folder_id, payload -> 'parents' ->> 0 as parent_id
    from {{ source('undercroft', 'records') }}
    where source = 'drive' and entity = 'folders' and deleted_at is null
),

up (file_id, folder_id, depth) as (
    select source_record_id, payload -> 'parents' ->> 0, 1
    from {{ source('undercroft', 'records') }}
    where source = 'drive' and entity = 'files' and deleted_at is null
    union all
    select up.file_id, f.parent_id, up.depth + 1
    from up
    join folders f on f.folder_id = up.folder_id
    where f.parent_id is not null
)

select file_id, folder_id, depth from up
```

Which folder means what -- a client, a status -- is the person's to say, as a list of ids in
the model that reads this one. A folder dragged elsewhere changes one `folders` record, and the
next build places every file beneath it under its new parent. Keep this model a table or a
view, not ephemeral.

## A workbook's rows

Every `.xlsx`, `.xlsm`, `.xls`, `.xlsb`, Google Sheet and CSV that lands is read into rows (a CSV as one
sheet with no name, by RFC 4180: a semicolon-separated file arrives as one column to split). A
workbook inside a zip is a document of its own: `metadata->>'archiveDocumentId'` names the
archive it came from. Nothing is decided for you: no header is chosen, no column named, no type inferred. Every cell is the string the file
stored, so the model decides what each column is.

- `document_sheets`: one row per sheet. It holds `sheet_index` (tab order), `sheet_name`,
  `sheet_state` (`visible`, `hidden`, `veryHidden`), `date1904`, `merges` (ranges such as
  `A1:F1`, never filled), `row_count`, and `complete`. When `complete` is false, `reason` says
  why, and the rows before that point are still there.
- `document_rows`: one row per non-empty row. It holds `row_number` (Excel's own, so the gaps
  are real), `hidden`, and three JSON maps keyed by column letter:
  - `cells` holds the stored strings;
  - `formats` holds the number format Excel shows a cell in, such as `dd/mm/yyyy`, or
    `builtin:14` for the locale's short date;
  - `faults` holds what is not a value: `#REF!`, `#DIV/0!`, or `formula-uncached`.

  `cells ->> 'D'` is NULL where `faults` holds D, so an error never reads as a word.

Join the two on `(tenant_id, sha256, sheet_index)`, and reach the file through `documents.sha256`. Read
the column letters, the header row and the first data row from a sample before you write
anything: `lake.query` over `raw.document_rows` with a `limit`. Every client's workbook is laid
out differently.

**A clean export, header in row 1.** Name the columns after the header the sample showed,
read from row 2 down:

```sql
select
    r.row_number,
    r.cells ->> 'A'                                        as account,
    r.cells ->> 'C'                                        as description,
    {{ parse_amount('r.cells', 'F') }}                     as amount,
    {{ excel_serial_date("r.cells ->> 'B'", 's.date1904') }} as booked_on
from {{ source('undercroft', 'document_rows') }} as r
join {{ source('undercroft', 'document_sheets') }} as s
    using (tenant_id, sha256, sheet_index)
where s.sheet_name = 'Account Transactions'
  and r.row_number > 1
```

**Title rows above the header.** An export often opens with a title, a company line and a
period before the header. Find the header row by a label it always carries rather than by a
fixed number, then read the rows below it:

```sql
with header as (
    select r.tenant_id, r.sha256, r.sheet_index, min(r.row_number) as row_number
    from {{ source('undercroft', 'document_rows') }} as r
    where r.cells ->> 'A' = 'Date'
    group by r.tenant_id, r.sha256, r.sheet_index
)

select r.*
from {{ source('undercroft', 'document_rows') }} as r
join header as h using (tenant_id, sha256, sheet_index)
where r.row_number > h.row_number
```

**Totals, merged titles and hidden helpers.** A totals row is data the workbook computed.
Leave it out by its label, such as `where r.cells ->> 'A' <> 'Total'`, and check it against
your own `sum` in a test rather than trusting it. A merged title lives in the first cell of
its range only. Filter `s.sheet_state = 'visible'` and `not r.hidden` only when the person
says hidden sheets and rows are working space, never by default.

**Dates typed by hand and dates Excel stored.** A date Excel stored is a serial, such as
`46286` for 2026-09-21, and `formats` shows it as a date. A date typed as text, such as
`21/09/2026`, has no date format. Tell them apart by `r.formats ->> 'B'`:

- convert a serial with `excel_serial_date` (or `excel_serial_timestamp` for a time of day),
  passing `s.date1904`;
- parse a typed date only in the form the person confirms;
- leave anything else NULL.

**A sheet that stopped short.** When `s.complete` is false, the rows after `reason` were not
read. Carry `complete` into the model, or leave the sheet out, and tell the person. Never
present a partial ledger's totals as the whole. A workbook in
`document_rows_refusal` has text but no rows; say so too.

## Building on other models

Join and aggregate models through `ref()`, never through their tables:

```sql
select
    d.stage,
    count(*)      as deals,
    sum(d.amount) as amount
from {{ ref('stg_hubspot_deals') }} d
where d.closed_at is not null
group by d.stage
```

`sum` over no readable amounts is `NULL`, which is correct: do not wrap it in
`coalesce(..., 0)`. A report can show that cell as missing; a zero would be a claim.

## Saving a query as a model

### A raw-lake query

The SQL somebody ran with `lake.query` reads the raw tables by name. To make it a model:

1. Replace `raw.records` with `{{ source('undercroft', 'records') }}` and `raw.documents`
   with `{{ source('undercroft', 'documents') }}`.
2. Add `deleted_at is null` unless the person wants deleted records, and write down why.
3. Remove the final `;`.
4. Remove a `limit` that was there to look at a few rows, and an `order by` that only
   served the look. Ask first if either might be meant.
5. Replace `select *` over the raw table with the columns the brief names: `payload` is not
   a column a report can use.

### A report question

A question's SQL reads models' tables by their bare names, because reports read the
customer's analytics schema. Read it with `bi.questions.get`; a question built in the
visual editor has no SQL of its own, so render it with `bi.compile` first. Then:

1. Replace each model table it reads with `ref()`: `from "stg_hubspot_deals"` becomes
   `from {{ ref('stg_hubspot_deals') }}`.
2. A question's parameters are written `{{ name }}`. A model has no parameters, and dbt would
   render one as an empty string, silently dropping the filter. Ask the person for a fixed
   value, or drop the filter and leave it to the report. `models.check` refuses one left in.
3. Remove the final `;` and any `limit`.

### SQL the person pastes

Ask where it runs today. Then treat it as whichever of the two above it resembles, and check
every table it names against `lake.summary` and `models.list`.

## Tests

Each column can carry `not_null` and `unique`, and nothing else. They are passed with the
save as `{ "columns": { "deal_id": ["unique", "not_null"] } }`. A test that fails does not
stop the build: the table is built, and the failing rows are kept for `dq.failures`.

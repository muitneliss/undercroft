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
- **Other models**, through dbt's `ref()`: `{{ ref('stg_hubspot_deals') }}`.

The project's own login reads only its own customer's rows, so a model never filters on
`tenant_id` to stay in bounds. Never name a raw table or another model's table directly
(`raw.records`, `analytics_case_0042.stg_deals`, or a bare `stg_deals`): `models.check`
refuses it, because dbt would not know what the model depends on.

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

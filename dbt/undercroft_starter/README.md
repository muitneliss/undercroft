# undercroft_starter

The example transform project. **Copy it; it is not a schema to conform to.**

Undercroft ships no business schema. `raw.records` holds every source's records as jsonb,
keyed `(source, tenant_id, entity, source_record_id)`. Everything above it is SQL you
write here.

## The pattern

A model filters `raw.records` to one `(source, entity)`, pulls typed columns out of the
jsonb payload, and lets the platform's rules hold in SQL:

- **Money through `parse_amount`** (`macros/parse_amount.sql`) — never a float, `NULL` for
  an unreadable value rather than a fabricated `0`.
- **Tombstones excluded** — `where deleted_at is null`, so an upstream deletion drops out
  of the projection rather than lingering as a live row.

`models/staging/stg_hubspot_deals.sql` is one worked example. Change the filter and the
columns and it is your model.

## How it runs

dbt runs in its own container via Kestra's dbt plugin, as the `undercroft_dbt` role. That
role can create only in `analytics` and `dq` and has **no access to `app`**, so a model
here cannot read a credential even by mistake — the platform's privilege model enforces it
rather than trusting the model author.

`store_failures` is pinned to the `dq` schema, which the BI role cannot read: a failing
test writes the offending rows (which contain source data) somewhere no dashboard can
reach them.

## Model contracts

DDL constraints (`numeric(18,4)`, `not null`) that the old hand-written schema enforced are
now advisory unless you opt into dbt **model contracts** (`enforced: true`). Doing so on a
mart restores compile-time enforcement of column types and nullability. It is opt-in, and
worth it on anything financial.

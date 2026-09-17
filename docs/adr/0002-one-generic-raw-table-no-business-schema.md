# 2. One generic raw table; the platform ships no business schema

- Status: Accepted
- Date: 2026-09-17

## Decision

Every source's records land in one table, `raw.records`, keyed
`(source, tenant_id, entity, source_record_id)` with the body as `jsonb`. It is
partitioned `BY LIST (source)` from the first migration. The platform ships no
`customers`/`deals`/`invoices` schema. Everything above raw is a user-authored dbt model.

## Why

The predecessor stated its schema three times by hand — in migrations, in
INSERT/ON CONFLICT strings, and in dashboard SQL — and served exactly one business
("B2B deals and invoices"). A generic platform cannot presume a customer's domain.

One table, not one per source, because a per-source table would require the platform to
know source names at DDL time — the coupling being removed — and would make cross-source
models a UNION whose arms change when a connector is added. Partitioning recovers the
cost: per-source pruning, `VACUUM`, and `DROP TABLE raw.records_x` to remove a connector's
data.

`PARTITION BY LIST` must be chosen in the first migration; converting a populated table
later is a full rewrite under `ACCESS EXCLUSIVE`.

## Consequences

DDL-enforced integrity (`numeric(18,4)`, `NOT NULL`, CHECKs) becomes advisory. dbt model
contracts (`enforced: true`) restore it for users who opt in; the starter demonstrates the
pattern. This is a real, documented reduction in built-in guarantees, traded for the
platform not having an opinion about anyone's data.

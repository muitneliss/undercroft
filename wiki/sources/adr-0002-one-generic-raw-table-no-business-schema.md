---
title: ADR 0002 One Generic Raw Table, No Business Schema
type: source
date: 2026-09-18
tags: []
source: docs/adr/0002-one-generic-raw-table-no-business-schema.md
source_path: docs/adr/0002-one-generic-raw-table-no-business-schema.md
source_hash: 681c6c8e0e4c3eb886f94043de3eb094e7701c886e57984ba3e3ad7d8bce8fe8
ingested: 2026-09-18
---

# ADR 0002 One Generic Raw Table, No Business Schema

## Decision

Every source's records land in one table, `raw.records`, keyed
`(source, tenant_id, entity, source_record_id)` with the body as `jsonb`, partitioned
`BY LIST (source)` from the first migration. The platform ships **no**
`customers`/`deals`/`invoices` schema. Everything above raw is a user-authored dbt model.

## Why

The predecessor stated its schema three times by hand — in migrations, in
INSERT/ON CONFLICT strings, and in dashboard SQL — and served exactly one business. A
generic platform cannot presume a customer's domain.

One table rather than one per source, because a per-source table would require the
platform to know source names at DDL time (the very coupling being removed) and would make
cross-source models a UNION whose arms change whenever a connector is added. Partitioning
recovers the cost: per-source pruning, `VACUUM`, and `DROP TABLE raw.records_x` to remove a
connector's data.

`PARTITION BY LIST` has to be chosen in the first migration — converting a populated table
later is a full rewrite under `ACCESS EXCLUSIVE`.

## Consequences

DDL-enforced integrity (`numeric(18,4)`, `NOT NULL`, CHECKs) becomes advisory. dbt model
contracts (`enforced: true`) restore it for users who opt in. This is a real, documented
reduction in built-in guarantees, traded for the platform not having an opinion about
anyone's data.

## Related

Raw's durability, which this table is a projection of, is [[ADR 0001 Raw Lake Is the Only Durable Layer]].

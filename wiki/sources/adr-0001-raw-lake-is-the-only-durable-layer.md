---
title: ADR 0001 Raw Lake Is the Only Durable Layer
type: source
date: 2026-09-18
tags: []
source: docs/adr/0001-raw-lake-is-the-only-durable-layer.md
source_path: docs/adr/0001-raw-lake-is-the-only-durable-layer.md
source_hash: 29b3d1b8a115203a481435e8eb0b52abaa026c2a9e16d8d99450440a64f49d42
ingested: 2026-09-18
---

# ADR 0001 Raw Lake Is the Only Durable Layer

## Decision

Source data lands unmodified and content-addressed in an immutable object store (S3 or
MinIO). That lake is the **only** layer treated as durable. Everything in Postgres —
`raw.records`, every dbt model, every mart — is a projection that may be dropped and
rebuilt from the lake.

Writes are create-only and idempotent by content: re-storing identical bytes writes
nothing and reports `unchanged`. Retention is bounded and reports what it pruned.

## Why

The lake is the one layer that cannot be recomputed. If a source edits or deletes its
side, whatever was not captured is gone permanently. Projections can always be rebuilt,
so they are never the source of truth.

Content addressing is the default rather than a later optimisation, on measured evidence:
a legacy provenance-addressed store held 15,790 artefacts over 5,259 distinct payloads —
10.42 GB where 1.98 GB would do, with one 6.8 MB document stored under 126 keys.

## Rejected

* **Postgres as the durable store.** It cannot hold arbitrary source bytes (PDFs,
  attachments), and a curated table that is the only copy of something is a lake with no
  archive underneath it.
* **A warehouse/lakehouse (Iceberg + a query engine).** Needs a catalog, a coordinator and
  compaction — a large operational surface for a platform whose thesis is "one
  `docker compose up`".

## Status

Accepted, 2026-09-17. This is the first of the repo's three governing rules and the one
the enforcement in `.claude/rules/raw-lake.md` exists to protect.

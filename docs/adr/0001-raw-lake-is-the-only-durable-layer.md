# 1. The raw lake is the only durable layer

- Status: Accepted
- Date: 2026-09-17

## Decision

Source data lands, unmodified and content-addressed, in an immutable object store (S3 or
MinIO). That lake is the only layer treated as durable. Everything in Postgres —
`raw.records`, every dbt model, every mart — is a projection that may be dropped and
rebuilt from the lake.

Writes are create-only and idempotent by content: re-storing identical bytes writes
nothing and reports `unchanged`. Retention is bounded and reports what it pruned.

## Why

The lake is the one layer that cannot be recomputed: if a source edits or deletes its
side, whatever we did not capture is gone. Projections can always be rebuilt, so they are
never the source of truth.

Content addressing is the default, not a later optimisation. A legacy store addressed by
provenance held 15,790 artefacts over 5,259 distinct payloads — 10.42 GB where 1.98 GB
would do, with one 6.8 MB document under 126 keys. Starting content-addressed skips the
retrofit entirely.

## Rejected

- **Postgres as the durable store.** It cannot hold arbitrary source bytes (PDFs,
  attachments), and a curated table that is the only copy of something is a lake with no
  archive underneath it.
- **A warehouse/lakehouse (Iceberg + a query engine).** Needs a catalog, a coordinator
  and compaction — a large operational surface for a platform whose thesis is "one
  `docker compose up`".

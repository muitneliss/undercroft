---
description: The raw lake is the only durable layer
paths:
  [
    "packages/lake/**/*.ts",
    "apps/worker/src/services/land*.ts",
    "apps/worker/src/services/loadToRaw.ts",
  ]
---

# The raw lake is the only durable layer

Raw cannot be recomputed. If a source edits or deletes their side, whatever we did not
capture is gone permanently. Everything downstream — `raw.records`, dbt models,
dashboards — is a projection that may be dropped and rebuilt freely. That asymmetry is the
whole design, and it is why this area is stricter than the rest of the codebase.

## NEVER

- **NEVER overwrite an existing object in place.** A store that can be overwritten is a
  cache, not an archive.
- **NEVER prune silently.** Silent pruning of a durable store is indistinguishable from
  data loss.
- **NEVER treat a curated table as durable.** If losing it would lose information, it
  belonged in raw.

## Follow

- **Create-only writes.** Writing where an object already exists is an error.
- **Idempotent by content.** Re-storing identical bytes writes nothing and reports
  `unchanged`. Without this, an hourly schedule pushes real history out through retention
  using nothing but copies of the same file.
- **Retention is bounded and reported.** Pruning names what it removed.
- **Content addressing is the default here**, not a later optimisation.

## The one thing the lake does not keep: a document's bytes, once read (ADR 0161)

The owner decided a document's file -- which lives in the customer's own Drive or mailbox -- is
not kept once the extract pass has attempted it and the passes that read bytes again (a
workbook's rows, an archive's members) are done. So for document content, and only for it,
`raw.document_text`, `raw.document_sheets`/`document_rows` and `raw.documents`' name, link and
purge record are the durable layer: they cannot be rebuilt, and must never be dropped as if they
could. Everything else in this file holds unchanged, and the purge obeys it:

- **One writer.** Blobs leave only through `LakeStore.purgeBlobs`, which deletes exactly the
  digests it is named and nothing else. Deciding which digests no document in any tenant still
  needs is Postgres's (`apps/worker/src/repos/documentPurge.ts`); the lake knows nothing of it.
- **Never silently.** It writes a `_reports/blob-purge/` report before it deletes, and every
  document it touched records `bytes_purged_at`, the outcome and that report's key.
- **Manifests and journal pointers stay.** `put` decides `unchanged` from them, so an unchanged
  file is never stored again; never purge them with the blob.

Each invariant is pinned by a test in `packages/lake/src/store.test.ts`. If you change one,
the test is the specification — change it deliberately and say why in the commit.

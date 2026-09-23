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

Each invariant is pinned by a test in `packages/lake/src/store.test.ts`. If you change one,
the test is the specification — change it deliberately and say why in the commit.

---
paths:
  - "vcdo/lake/**/*.py"
  - "vcdo/sources/**/*.py"
---

# The raw lake is the only durable layer

Raw cannot be recomputed. If a source edits or deletes their side, whatever we
did not capture is gone permanently. Everything downstream — curated tables,
marts, dashboards — is a projection that may be dropped and rebuilt freely.
That asymmetry is the whole design, and it is why this directory is stricter
than the rest of the codebase.

## NEVER

- **NEVER overwrite an existing object in place.** A store that can be
  overwritten is a cache, not an archive.
- **NEVER prune silently.** Silent pruning of a durable store is
  indistinguishable from data loss.
- **NEVER treat a curated table as durable.** If losing it would lose
  information, it belonged in raw.

## Follow

- **Create-only writes.** Writing where an object already exists is an error,
  never a silent replace.
- **Idempotent by content.** Re-storing identical bytes writes nothing and
  reports `unchanged`. Without this, an hourly schedule pushes real history out
  through retention using nothing but copies of the same file.
- **Retention is bounded and reported.** Pruning names what it removed.
- **Content addressing is the default here**, not a later optimisation.

Each invariant is pinned by a test. If you change one, the test is the
specification — change it deliberately and say why in the commit, or you have
changed the archive's guarantees by accident.

Record-oriented sources go through dlt; byte-oriented paths (Drive PDFs, Gmail
attachments) go through `vcdo.lake.LakeStore`, because no record-oriented ELT
tool writes binary files. See ADR 0003 and `vcdo/lake/store.py`.

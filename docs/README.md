# Documentation index

Read in this order if you are new.

## Start here

| Document | What it tells you |
|---|---|
| [../CLAUDE.md](../CLAUDE.md) | Working conventions. Binding. Read before changing anything. |
| [data-platform-handoff.md](data-platform-handoff.md) | The original requirement spec. Kept verbatim — where it and an ADR disagree, the ADR records the deviation and why. |

## Decisions (`adr/`)

Numbered, dated, and immutable once accepted. A reversal gets a **new** ADR that
supersedes the old one; we never edit a decision to look like it was always
different, because then the reasoning that produced it is lost.

| ADR | Decision | Status |
|---|---|---|
| [0001](adr/0001-hosting-and-raw-to-curated-route.md) | S3 raw lake + Postgres curated; Dokploy raw-compose deployment; measured host capacity | Accepted (§2 and §3 superseded by 0003) |
| [0002](adr/0002-source-mock-mode.md) | Mock mode as a first-class source mode; retention deliberately deferred | Accepted |
| [0003](adr/0003-ingestion-without-airbyte.md) | No ingestion platform: one worker container, dlt as a library | Accepted |
| [0004](adr/0004-control-plane-ui.md) | A control plane UI, and why it is not the ingestion platform 0003 rejected | Accepted |
| [0005](adr/0005-per-tenant-credentials-sealed-in-postgres.md) | Per-tenant OAuth credentials sealed in Postgres, in a schema BI cannot read | Accepted |
| [0006](adr/0006-tenant-scoped-keys-and-run-ledger.md) | Tenant-scoped byte keys and run ledger; the run id stops being a process singleton | Accepted (ledger half void; see 0007) |
| [0007](adr/0007-remove-the-run-ledger.md) | Remove the run ledger; partial shortfall is no longer detected | Accepted |

## Contracts (`contracts/`)

Data contracts — ingestion, curated grain and keys, metric definitions.
Being written as each phase lands.

## Runbook (`runbook/`)

Operational procedures: alerts, credential rotation, retry and replay, backfill,
backup and restore, rollback. Written in Phase 6, against the deployed
environment rather than in advance.

## Source reference

The legacy system at `vcc-ostwin-architecture-review` solves the same domain
problem on a single operator machine. It is the reference for domain rules —
entity identity, Xero API behaviour, currency and GST policy, PII handling — and
is **not** a dependency. Read it before designing; do not import from it.

Several decisions here exist because that system measured something expensive:
the raw-lake deduplication ratio, the instability of Gmail attachment ids, the
Xero credit-note payment quirk, and the volatile-key identity failure that
repointed 178 of 358 mappings at the wrong company.

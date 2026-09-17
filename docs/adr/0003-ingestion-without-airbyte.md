# ADR 0003 — Ingestion without Airbyte: one worker container using dlt

- **Status:** Accepted
- **Date:** 2026-09-17
- **Deciders:** Cuong Tran (owner), implementing agent
- **Supersedes:** the ingestion decision in [ADR 0001](0001-hosting-and-raw-to-curated-route.md) §Decision 2

## Context

ADR 0001 chose Airbyte for all four sources, with a reconciliation gate around its
Xero connector. Implementation ran into a problem with that choice, and the owner
decided against Airbyte: the operational cost is out of proportion to what this
platform needs.

The concrete finding is that **Airbyte no longer has a Docker Compose deployment
at all.** Support was not merely deprecated — it was removed, the `--migrate`
path was deleted from `abctl`, and as of Self-Managed 2.2 the supported installs
are `abctl` (which runs a `kind` Kubernetes cluster inside Docker) or Helm on a
real cluster. Building a Compose stack anyway would mean pinning an abandoned
2024-era version, which is precisely the "unsupported all-in-one Docker Compose
stack" the handoff warns against.

The requirement is a stack that runs from one `docker compose up`.

## The finding that decided it

**No record-oriented ELT tool can do half of our scope.**

Singer taps and dlt both emit JSON records. Neither writes binary files. But
landing the *original PDF bytes* from Google Drive and from Gmail attachments into
S3 is a hard requirement with its own acceptance tests — two PDFs verified by
SHA-256 against source fixtures, in two distinct raw prefixes, with provenance
manifests.

So **custom workers are required for the byte paths regardless of which tool we
choose for records.** Any ingestion platform we add is a second runtime that still
leaves the harder half unsolved.

Coverage as measured, 2026-09-17:

| Source | Meltano | dlt | Legacy repo |
|---|---|---|---|
| HubSpot | `tap-hubspot` (community) | **verified source** | proven puller |
| Xero | `tap-xero` (community) | REST toolkit | **proven, incl. the credit-note quirk** |
| Gmail records | `tap-gmail` (community) | REST toolkit | proven |
| Drive | **no extractor** (only a file-download utility) | filesystem source | proven |
| **PDF bytes** | **not possible** | **not possible** | **proven** |

Meltano is actively maintained (v4.2.0, April 2026), so health was not the issue.
The Drive gap and the bytes gap were.

## Decision

**One `vcdo-worker` container, in the same compose file as everything else.**

- **Record-oriented sources** use [dlt](https://dlthub.com/docs/intro) as a
  *library* — `pip install dlt`, no server, no UI, no separate service. It
  supplies pagination, authentication, incremental state and schema inference.
  HubSpot has a verified source; Xero and Gmail metadata use dlt's declarative
  REST API toolkit.
- **Byte-oriented paths** (Drive PDFs, Gmail attachments) use our own
  `vcdo.lake.LakeStore`, which already gives content addressing, create-only
  writes, SHA-256 manifests and replay.
- **Scheduling** is Kestra, which is already in the stack. dlt does not need or
  provide an orchestrator.

Total added infrastructure: **one container**. No Kubernetes, no second plugin
system, no additional UI to secure and back up.

## Why not the alternatives

**Airbyte via `abctl`** — the supported route, and genuinely capable, but it runs
a Kubernetes cluster and ~10 GB of images to solve a problem we have four
connectors' worth of. The target host has 11.8 GB free and no swap, shared with
eleven other projects whose container count grew 26 → 31 in a single day.

**Meltano as a service** — a real connector ecosystem and config-driven pipelines,
but no Drive extractor exists, the PDF paths remain custom, and it adds a second
runtime and plugin system for the portion of the work that was already easiest.

**Pure custom Python, no framework** — viable, and the legacy pullers already work
against these exact tenants. Rejected because we would hand-roll pagination,
retry, cursor state and schema evolution that dlt maintains for us. The legacy
domain logic still comes across; dlt replaces the transport plumbing, not the
adjudication.

## Consequences

- **We lose Airbyte's connector catalogue.** Adding a fifth source later means
  writing a dlt REST source rather than clicking a connector. For four sources
  with this much source-specific domain logic, that trade is favourable; if the
  source count grows substantially, revisit.
- **We own cursor and state handling**, via dlt's incremental state rather than a
  platform's connection state. It must be persisted somewhere durable and be
  part of the backup set.
- **The Xero reconciliation gate from ADR 0001 survives unchanged**, and matters
  just as much. We are now the connector, so nothing else is checking our
  arithmetic.
- **The mock/live seam from ADR 0002 becomes more valuable, not less.** With no
  vendor connector in between, `mock` and `live` differ only in which dlt source
  is constructed.
- Testing still happens at the raw-lake seam. Fixtures write records into MinIO
  directly, so the curated layer, crosswalk, money contract and dashboards remain
  fully testable offline with no credentials.

## Verification

The stack must come up with a single command and nothing else installed:

```bash
make up && make doctor
```

Phase 1 closes when `make slice` runs HubSpot fixtures from raw through curated to
a dashboard query, with the run ledger reporting `unaccounted == 0`.

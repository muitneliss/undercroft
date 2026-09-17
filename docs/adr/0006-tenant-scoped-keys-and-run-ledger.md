# ADR 0006 — Tenant-scoped byte keys and a tenant-scoped run ledger

- **Status:** Accepted. The **run-ledger half is void** — [ADR 0007](0007-remove-the-run-ledger.md)
  removed the ledger entirely. The byte-key and run-id findings still stand, and the
  reasoning about why a cached run id is wrong still applies: the id is stamped into every
  lake manifest and curated row, not only into the ledger it no longer has.
- **Date:** 2026-09-17
- **Deciders:** Cuong Tran (owner), implementing agent
- **Amends:** the object-key contract in `vcdo/sources/base.py`; the ledger key in [ADR 0001](0001-hosting-and-raw-to-curated-route.md) §Decision 1

## Context

The record path was already tenant-scoped, and deliberately so.
`vcdo/sources/base.py` argues it at length: source record ids are only unique
*within* a tenant, and "you cannot restrict or erase one tenant's raw data if it
is interleaved with another's".

Preparing for multiple real customers found three places where that reasoning had
not been carried through. All three are quiet: none raises, none fails a test,
and each produces something that looks like a fact.

### 1. The run ledger merged tenants

`vcdo/core/obs_log.py` cached the run id in `os.environ["VCDO_RUN_ID"]` for the
life of the process and never regenerated it. That is right for a one-shot CLI
run, where a subprocess should inherit its parent's id. It is wrong for the
worker, which is long-lived and serves many runs.

So two tenants synced by the same worker process **shared a run id**. Stage names
carry no tenant — `curate:hubspot` is the same string for everyone —
`ops.run_ledger` was keyed `(run_id, stage)`, and `flush_run_ledger` projects it
with `ON CONFLICT DO UPDATE`.

The second tenant's row silently overwrote the first's, **including
`unaccounted`** — the one number the ledger exists to report, and the signature
of the worst class of data bug this platform guards against.

### 2. Byte keys carried a person, or no tenant at all

```
gmail/attachments/{mailbox}/{message_id}/{part_id}/{filename}
drive/pdf/{file_id}/{name}
```

The Gmail key led with a **mailbox address** — personal data, in the one part of
the lake that appears in listings, logs and error messages. The Drive key had
**no tenant at all**, so Drive documents could not be attributed, restricted or
erased per customer. Both contradict `base.py`'s own stated reasoning. Neither
filename carried uniqueness the ids did not already carry.

### 3. `ops.gate_finding` and `dq.quarantine` had no tenant

`dq.quarantine` holds rejected rows *with their original payload*. Without a
tenant column, erasing one customer's quarantined raw data is impossible — a PDPA
problem, given ADR 0002 already defers the retention decision with a deadline.

## Decision

**Run identity.** Add `vcdo.core.obs_log.new_run_id()`, which generates and
exports a fresh id, and call it at the start of each run in the trigger server.
`run_id()` keeps its inherit-or-create behaviour, so subprocesses of a run still
inherit. Every log line now carries `tenant_id`.

**Ledger key.** `ops.run_ledger` becomes `PRIMARY KEY (run_id, stage,
tenant_id)`. Belt and braces: with a fresh id per tenant-run the pair is already
unique, but putting the tenant in the key makes the silent overwrite
*structurally* impossible rather than merely unlikely. `''` rather than NULL,
because a primary-key column cannot be null and rows written before the column
existed stay addressable.

**Byte keys.**

```
gmail/{tenant_id}/attachments/{message_id}/{part_id}
drive/{tenant_id}/pdf/{file_id}
```

The mailbox and the filename move to the manifest, where access is controlled —
removed from the key, not lost. `part_id` is positional and already unique within
a message, so nothing that distinguished two objects has gone.

**Tenant columns** added to `ops.run_ledger`, `ops.gate_finding` and
`dq.quarantine`, with indexes for per-tenant history.

## Why this is a cutover and not a migration

The lake is create-only, so old objects under the old keys cannot be renamed —
only re-landed under the new ones, or left where they are.

It does not matter here. Every source is still in `mock` mode and
`docs/runbook/deployment.md` records that no production credential exists yet.
The only objects under the old keys are fixtures. **This is the last moment this
change is free**, which is the reason it is being made now rather than when it is
noticed.

## What this amends

`vcdo/sources/base.py`'s docstring described the record key as the contract. That
contract now extends to the byte paths, which were the exception it did not
mention. The module docstrings in `gmail.py` and `drive.py` were both updated to
say what they now do rather than what they intended to.

## Consequences

- Per-tenant erasure is a prefix delete, not a scan.
- The lake browser in the control plane can be scoped by prefix rather than by
  filtering after listing everything — a filter one bug away from showing another
  customer's object names is not a boundary.
- `tests/integration/test_pdf_acceptance.py` gained per-run isolation it never
  had: `drive/pdf/<file id>` was global, so two runs against the same bucket
  wrote to the same objects.
- Ledger rows written before this change keep `tenant_id = ''` and remain
  queryable. They are not back-filled; nothing knows which tenant they belonged
  to, and inventing an answer is the failure this ADR is about.

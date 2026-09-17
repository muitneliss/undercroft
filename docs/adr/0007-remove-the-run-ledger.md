# ADR 0007 — Remove the run ledger

- **Status:** Accepted
- **Date:** 2026-09-17
- **Deciders:** Cuong Tran (owner), implementing agent
- **Supersedes:** the run-ledger decision in [ADR 0001](0001-hosting-and-raw-to-curated-route.md) §Decision 1
- **Amends:** [ADR 0006](0006-tenant-scoped-keys-and-run-ledger.md), whose ledger half no longer applies
- **Also invalidates:** [ADR 0003](0003-ingestion-without-airbyte.md)'s stated verification,
  which was "a dashboard query, with the run ledger reporting `unaccounted == 0`".
  The verification is now the dashboard query alone. Those ADRs are left as
  written — a decision is not edited to look like it was always different — so
  this line is where the change is recorded.

## Context

`ops.run_ledger` recorded one row per pipeline stage per run: rows read, rows
stored, rows deliberately excluded with a reason, and the residual
`unaccounted = rows_in - rows_out - rows_excluded`. A non-zero residual meant
records had disappeared without anyone deciding they should.

It did not originate in this repo. The concept came from the legacy system's
`wa-observability` work — `LAT-1-so-chay-dung-chung.md`, `tests/unit/test_run_alerts.py`
— and arrived here in the commit "Phase 0: local stack, mock-mode config,
observability core". It was carried over as an assumption rather than chosen,
and no ADR before this one examined whether the new platform needs it.

The owner has decided it does not.

## Decision

Remove it entirely:

| Removed | Was |
|---|---|
| `vcdo/core/run_ledger.py` | the `stage()` context manager and its arithmetic |
| `vcdo/core/alerts.py` | `stage_error`, `rows_unaccounted`, `row_count_drop`, `source_silent` |
| `ops.run_ledger` | the table (migration 008 drops it) |
| `flows/run_health.yml` | the hourly alert flow |
| `vcdo alerts`, the `alerts` trigger verb | |
| `vcdo/api/routers/runs.py`, `ui/src/routes/Runs.tsx` | run history in the control plane |

## What this gives up, stated plainly

**Partial shortfall is no longer detected.** That is the whole of it, and it is
worth naming precisely rather than softening.

Two failure shapes:

- A source returns **nothing**. Still caught, loudly: `land()` raises
  `SourceError` on zero records, and a `SourceError` is never converted into a
  successful run with fewer rows. This is the HubSpot-403 case the legacy system
  was bitten by, and it remains covered.
- A source returns **less than it should** — a filter that silently excludes, a
  transform that drops a shape it does not recognise, a paginator that stops
  early. Nothing now notices. The run is green, the table is smaller, and the
  only signal is a dashboard figure that looks like a quieter month.

`.claude/rules/data-integrity.md`'s "never treat no evidence as pass" still
governs *values* — `money.py` still refuses to guess an amount, `names.py` still
refuses to guess an identity, and `dq.quarantine` still records every row the
pipeline refused, with its reason and payload. What is gone is the check on
*counts*.

## Why it was accepted anyway

Three things were true about the ledger as it stood, and they were the owner's
grounds:

1. **It was never decided on.** It came over from the legacy system with its
   assumptions attached, into a platform whose shape is different — containers
   and Postgres rather than one operator's machine with SQLite and CSV.
2. **Its alerting was unusable.** `evaluate()` took every row ever written, with
   no time window, and treated any non-zero `unaccounted` as critical. One past
   incident kept the alert red forever, and the hourly `run_health` flow failed
   continuously. An alert that is always firing is an alert nobody reads — and it
   would have hidden a real shortfall the day one happened.
3. **It carried a legacy write path.** The JSONL-then-project design existed so
   the ledger survived a database outage, on a machine where the database was a
   local file. Here `run_slice` begins with `migrate()`; Postgres down means no
   run at all, so that property bought nothing.

Points 2 and 3 were fixable without removing the ledger, and that was the
recommendation put to the owner. The owner's call was to remove it.

## What deliberately stays

- **`dq.quarantine`** — rejected rows with their reason code and original
  payload. This is now the *only* per-row record of something the pipeline
  refused, which makes it more load-bearing than before, not less. The Metabase
  "Rejected rows" question replaces the "Run health" one.
- **`ops.generation`** — which run is currently serving. A different question:
  publish atomicity, not row accounting. It is what stops a failed run from
  half-replacing a good one.
- **`ops.gate_finding`** — the Xero reconciliation gate and identity conflicts.
- **The run id**, and `new_run_id()` with it. The id is stamped into every lake
  manifest, curated row, quarantine record and gate finding, so ADR 0006's
  finding still applies: a long-lived worker that caches one id across tenants
  makes "which run produced this object" unanswerable. Only the ledger-key half
  of ADR 0006 is void.
- **`ObsLog` and `events.jsonl`** — structured logging, unchanged.

## Consequences

- The control plane can start a sync but cannot show what happened afterwards.
  The worker holds live status in memory and loses it on restart, so the UI now
  confirms "sync started" and stops there. That confirmation is load-bearing, not
  decorative: a button that reports nothing is indistinguishable from one that
  does nothing.
- The scheduled flows still detect *failure* — they assert the worker returned
  200, and a raised exception is still a 500. What they no longer detect is a
  run that succeeded while losing rows.
- `migrations/008_drop_run_ledger.sql` drops the table. Migration 001 is left
  intact: it has been applied to a deployed database, so editing it would leave
  the table present on existing environments and absent on new ones.

## Reversing this

The arithmetic was cheap — one row per stage per run, ~15 rows per run. If
partial shortfall ever needs detecting again, the honest way back is a new ADR
superseding this one, and the two fixes that were on the table when it was
removed: a time window on the alert evaluation, and writing straight to Postgres
rather than through a file.

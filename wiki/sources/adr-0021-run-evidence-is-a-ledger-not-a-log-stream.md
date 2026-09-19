---
title: ADR 0021 Run Evidence Is a Ledger, Not a Log Stream
type: source
date: 2026-09-19
tags: []
source: docs/adr/0021-run-evidence-is-a-ledger-not-a-log-stream.md
source_path: docs/adr/0021-run-evidence-is-a-ledger-not-a-log-stream.md
source_hash: ba24f1626e4a109d4f6eb67073ba90b2c1fbabefaaef64130571c95af61a6ffa
ingested: 2026-09-19
---

# ADR 0021 Run Evidence Is a Ledger, Not a Log Stream

# ADR 0021 Run Evidence Is a Ledger, Not a Log Stream

## Decision

**The worker appends enumerated events to `ops.run_event` as a run proceeds**, the control
plane serves them through `runs.events`, and the journal's leaf re-reads them every two
seconds while a run is live. The worker's JSONL on stdout is unchanged; this is a second,
narrower channel aimed at the customer's administrator rather than at an operator with shell
access.

## The problem it answers

Three runs of one tenant, all green or still going, about which the interface could say
nothing:

* A Gmail ingest sat at `running` for sixteen minutes — not stuck, but one paced
  `messages.get` per message — while `runs.get` withholds counts for a run in progress, so
  every column read as MISSING for the duration.
* Three Drive ingests closed `ok` in under half a second with `files 0 / documents 0`: the
  picked folder held no PDFs one level down, which is documented behaviour and exactly the
  sentence nobody could read.
* Every transform closed `ok` with no steps, because the tenant has no models and dbt is
  never spawned for a tenant with none.

In each case the worker had already said so on stdout, inside a container the control plane
cannot reach.

## Options rejected

**Server-Sent Events proxied by the control plane.** A stream exists only while somebody
watches it: a reload, a redeploy or a worker restart loses it, and the commonest reading of
this evidence is the next morning about a run nobody watched. It would also add a streaming
route through the trigger-token hop and a per-run subscriber registry in the worker.

**Mirroring stdout into the table.** Rejected on the payload boundary: an exception message
routinely embeds the row that caused it, and dbt's output can echo the values of a failing
test — which is why `transform.ts` keeps only a twenty-line tail. A table of free text in
`ops` is one grant away from a dashboard.

**A log aggregator.** Answers an operator's question rather than a customer's, and adds a
service to a host with no swap.

## What follows from it

* **Granted like `ops.run_refusal`, not like `ops.run`.** BI keeps its read on `ops.run` —
  whether a sync happened is a reportable fact — and is refused the feed beneath it. No dbt
  role gets either.
* **Bounded, and the bound reports itself.** 200 events per run; past that only warnings and
  errors, plus one `events_truncated` row. Progress lines are coalesced to one per entity per
  two seconds off an injected `Clock`.
* **Writing evidence never fails the work.** The journal writes on a serialised chain the
  caller does not await; a failure is reported to the log and the run continues.
* **It goes when the run goes** (`ON DELETE CASCADE`): evidence about a run, not an archive.
* **The events are a fixed vocabulary** — `run_opened`, `entity_started`, `work_listed`,
  `records_read`, `entity_done`, `picks_listed`, `documents_landed`, `no_models`,
  `dbt_finished`, `run_closed`, `run_failed` — and every sentence is in the UI catalogues, so
  the feed reads in Vietnamese and English without the worker knowing either.

## The rule it restores

`readOneFile` in the Drive collector used to drop a directly-picked non-PDF and return
nothing, making "we were given nothing" and "we refused what we were given" the same green
run landing 0. It now returns the refusal and the run records it with reason `not-a-pdf`,
which is what CLAUDE.md rule 2 asks for.

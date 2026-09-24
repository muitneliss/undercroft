---
title: 'ADR 0051: A deploy stops a run at a safe point, and the run keeps its counts'
type: source
date: 2026-09-24
tags: []
source: >-
  docs/adr/0051-a-deploy-stops-a-run-at-a-safe-point-and-the-run-keeps-its-counts.md
source_path: >-
  docs/adr/0051-a-deploy-stops-a-run-at-a-safe-point-and-the-run-keeps-its-counts.md
source_hash: b53d69578da31bc8f6a511f37f9cdf1ab29388e0828d6c10ced9cc4055298e78
ingested: 2026-09-24
---

# ADR 0051: A deploy stops a run at a safe point, and the run keeps its counts

Accepted 2026-09-24. Issue #196.

**Context.** A large first Gmail ingest "failed every time" with `the worker restarted while this run was in progress`, every such run showed 0 created, changed, unchanged and refused, and the reporter concluded that each attempt started over and the source could never finish. Of six runs with that message, three (2026-09-21/22) were OOM kills at the old 1 GiB limit, before ingests streamed ([[An ingest streams, and does not re-read what it already holds]]); the other three coincide to the minute with the v1.17.0, v1.25.0 and v1.28.1 deploys. Dokploy's `docker compose up --pull always --wait` recreates the worker -- SIGTERM, then SIGKILL after Docker's default 10 s -- and `server.ts` had no signal handler, so the worker died at once, the run stayed `running`, and `closeAbandonedRuns` closed it `failed` at the next boot with no counts. Resume already worked: a run lands and projects each 200-record chunk as it goes and marks every message whose documents are down ([[ADR 0035: A harvest records what it settled, rather than asserting it]]), and a later run of the same mailbox had kept 1,800 marked messages. What was wrong: a deploy killed a run with no chance to land what was safe; counts were written only at settle, so a killed run that had landed chunks still read 0 of everything (a false value, CLAUDE.md rule 2); and the boot message could not be told apart from "failed having landed nothing".

**Decision.** `server.ts` handles SIGTERM/SIGINT: it aborts an `AbortController` whose signal every run receives as `RunDeps.stop`, waits for in-flight jobs through `drainJobs` for at most `DRAIN_MS` (45 s), and exits; a second signal exits at once. The worker declares `stop_grace_period: 60s` in both compose files, and the two numbers are one decision. The spec path checks the signal after each record goes into the sink and before each entity: it closes the sink, records the entity's counts, and throws `RunStopped` from above the sync-cursor write, so a partial read never advances the watermark ([[ADR 0034 The Watermark Is a Table Not a Max]]). The Google path checks between harvest items (before and after each `next()`): it closes the record sink, which holds only records whose documents are down; it does NOT release pending records, whose attachments would take minutes of paced fetches, and abandons the document sink's buffer (`DocumentSink.abandon`); and it skips what only a whole walk may decide -- Drive's tombstone sweep, which over a partial walk would report every unreached file deleted, and the per-pick refusals. The run settles `failed` with the counts it landed and `RUN_STOPPED` as its error, and journals `run_stopped` with the totals, worded in both UI languages. `closeAbandonedRuns` now says its zeroes are not a count: the worker stopped abruptly, anything landed before then is kept and not landed twice. Transform and extract are unchanged.

**Consequences.** A deploy mid-ingest usually costs only the records read since the last released chunk. A stop is not always honoured in time -- a Gmail listing is one `next()` and can take minutes, and a full buffer of attachments lands inside one iteration -- so those runs outlast the bound and are closed at boot, now truthfully. A deploy may wait up to 45 s longer; the first deploy of the change still kills, because the replaced image has no handler. An ingest started during the drain window opens and stops at once with honest zeroes. A stopped run is still `failed` and still raises the failure notice.

**Rejected.** A new `interrupted` status (a CHECK-constraint migration and a change to every reader to say what the error already says); per-chunk durable counts on `ops.run` (a write per chunk on the hot path and a second writer of the totals racing `settle`; revisit if kills rather than deploys dominate); bigger chunks (lose more per kill and bring back ADR 0033's memory profile); landing the pending records and buffer on the way out (outlives any grace period); racing `next()` against the signal (leaves an ownerless `next()` running after its run settled); only rewording the boot message (leaves the false counts).

# 51. A deploy stops a run at a safe point, and the run keeps its counts

- Status: Accepted
- Date: 2026-09-24

## Context

Issue #196: a large first Gmail ingest "fails every time" with
`the worker restarted while this run was in progress`, every such run reports 0 created,
changed, unchanged and refused, and the reporter concluded that each attempt starts over and
the source can never finish.

Six runs in production carry that message. Three, on 2026-09-21 and 22, were kernel OOM
kills at the old 1 GiB limit, before ingests streamed (ADR 0033). The other three, at
2026-09-23 03:17 and 2026-09-24 09:54 and 16:17, coincide to the minute with the v1.17.0,
v1.25.0 and v1.28.1 deploys. Dokploy runs `docker compose up --pull always --wait`, which
recreates the worker: SIGTERM, then SIGKILL after Docker's default 10 seconds. `server.ts`
installed no signal handler, so the worker died at once, the run stayed `running`, and
`closeAbandonedRuns` closed it `failed` at the next boot with no counts.

The conclusion drawn from that was wrong, but the record invited it. Resume already worked: a
run lands and projects each chunk of 200 records as it goes, marks every message whose
documents are down (ADR 0035), and the next run skips those. A later run of the same mailbox
had already kept 1,800 marked messages and was still going. The two reported runs were zero
honestly: one was killed during the four-minute listing of 28,358 message ids, the other 191
messages in, short of its first chunk.

Three things were actually wrong:

1. A deploy killed an in-flight run with no chance to land what was safe or record anything.
2. A run's counts were written only when it settled, so a killed run that HAD landed chunks
   also read 0 of everything -- a false value, which CLAUDE.md rule 2 forbids.
3. The boot-time message could not be told apart from "failed having landed nothing".

## Decision

**The worker stops gracefully, and a stopped ingest settles itself with what it landed.**

- `server.ts`, the only module that may know it is a process, handles SIGTERM and SIGINT. It
  aborts an `AbortController` whose signal every run receives as `RunDeps.stop`, waits for the
  jobs in flight through `drainJobs` for at most `DRAIN_MS` (45 s), and exits. A second
  signal exits at once.
- The worker service declares `stop_grace_period: 60s` in both compose files, so the bound
  sits inside Docker's wait with room for the exit. The two numbers are one decision and each
  says so beside itself.
- An ingest honours the signal at a boundary where what it landed is whole:
  - **Spec path**: after each record goes into the sink, and before each entity. It closes the
    sink, writes the entity's counts into the ledger, and throws `RunStopped` from above the
    sync-cursor write, so a partial read never advances the watermark (ADR 0034). No further
    entity is started.
  - **Google path**: between harvest items, looking before each `next()` and after it. It
    closes the record sink, which holds only records whose documents are down, so it lands in
    seconds. It does NOT release the pending records, because that means fetching their
    attachments first -- minutes at Gmail's paced rate -- and it abandons the document sink's
    buffer (`DocumentSink.abandon`) for the same reason; those messages are unmarked, so the
    next run reads them again. It skips everything only a whole walk may decide: Drive's
    tombstone sweep, which over a partial walk would report every file not yet reached as
    deleted, and the per-pick refusals.
- The run then settles `failed` with the counts it landed and `RUN_STOPPED` as its error, and
  journals `run_stopped` with the totals, which the UI words in both languages.
- `closeAbandonedRuns` now says what its zeroes are: the worker stopped abruptly, the run
  could not record its counts, anything landed before then is kept and not landed twice.
  That message now means a kill -- OOM, SIGKILL, or a graceful stop that ran out of time.

Transform and extract runs are unchanged: they are not told to stop, a drain that outlasts
them leaves them to the boot, exactly as before.

## Consequences

- A deploy during an ingest costs, in the common case, the records read since the last
  released chunk: the next run reads them again, idempotently.
- A stop is not always honoured in time. A Gmail listing is one `next()` and can take
  minutes; a full buffer of attachments lands inside a `next()` iteration and cannot be
  interrupted without abandoning a half-fetched chunk. Those runs outlast the 45 s bound and
  are closed at boot as before -- but with a message that no longer calls their zeroes a
  count.
- A deploy now waits up to 45 s longer while a run is in flight. The first deploy of this
  change still kills: the image being REPLACED has no handler.
- An ingest the scheduler starts during those 45 s opens and stops at once, settling `failed`
  with the stop message and honest zeroes. Refusing it before a row exists would need a new
  HTTP status in the worker's contract; the window is short and the record is true.
- A stopped run is still `failed`, so it still raises the failure notice. The message says
  nothing is wrong with the source.

## Options rejected

- **A new `interrupted` status.** `ops.run.status` allows `running`, `ok` and `failed` by a
  CHECK constraint, and its readers -- the UI's run marks (`runMark` refuses an unknown
  status outright), the run contracts, the failure alerts -- branch on those three. A fourth
  value would be a migration plus a change to each of them to express what the error text
  already says. A stopped run did not read its source to the end, so `failed` is not false.
- **Write the counts to `ops.run` per chunk.** It would make even a KILLED run's counts
  real, which this decision does not. But it is a write per chunk on the hottest path, a
  second writer of the run's totals racing `settle`, and a partial-count state for every
  reader to understand while the run is live. The journal's progress lines already show a live
  run's progress. Revisit if kills, not deploys, turn out to be the common case.
- **Bigger chunks.** Fewer, larger chunks would lose more per kill, not less, and bring back
  the memory profile ADR 0033 removed.
- **Land the pending records and the document buffer on the way out.** Thorough, and wrong
  under a deadline: a buffer of attachments at Gmail's paced rate outlives any grace period,
  and a stop that is cut off by SIGKILL half way through settles nothing at all.
- **Race the harvest's `next()` against the signal**, so a stop during a long listing is seen
  at once. The abandoned `next()` keeps running -- paced Google requests, a `raw.records`
  probe -- after its run has settled, which is work with no owner. The listing has landed
  nothing to lose, and the boot closes that run truthfully.
- **Leave it, and only reword the boot message.** It would fix (3) and leave (1) and (2):
  every deploy during an ingest would still produce a run whose counts are false.

# 56. A Drive ingest stops within one file, and a run the drain gives up on says it was cut off

- Status: Accepted
- Date: 2026-09-25
- Supersedes: in [ADR 0051](0051-a-deploy-stops-a-run-at-a-safe-point-and-the-run-keeps-its-counts.md),
  the sentence that `closeAbandonedRuns`' message "now means a kill -- OOM, SIGKILL, or a
  graceful stop that ran out of time"; the sentence that a drain which outlasts a transform or
  an extract "leaves them to the boot, exactly as before"; and the consequence that "a full
  buffer of attachments lands inside a `next()` iteration and cannot be interrupted"

## Context

Issue #219: Drive ingests "keep dying, maybe out of memory". Three manual runs of one tenant's
`drive` source failed on 2026-09-25, each closed at the next boot with `RUN_ABANDONED` -- _the
worker stopped abruptly ... (it was killed or ran out of memory)_. No Drive ingest had ever
succeeded on that instance.

The server says otherwise. The kernel journal has no OOM kill that day, the worker's
`.State.OOMKilled` is false, and it is nowhere near its 3 GiB limit. Each death lines up with a
release deploy: SIGTERM, then the worker exiting on its own about 45 seconds later, with no
SIGKILL. Forty-five seconds is `DRAIN_MS` (ADR 0051) giving up with `drained: false`. So each
Drive run was told to stop, did not reach a safe point within the drain, and was left `running`
by a process that then exited on purpose -- and the boot called that a kill. Five releases went
out in six hours that day, and a Drive ingest takes more than 44 minutes.

Why Drive did not stop: ADR 0051 put the Google path's stop boundary between harvest items, and
`collect.ts` held items back two hundred at a time, fetching their documents together in one
flush of the document sink. Nothing inside that flush looked at the signal. For Gmail that
flush is attachments, and a message often has none. For Drive every item IS a download, so
nearly all of a Drive run's wall time is spent inside a flush -- the third run read 1,458 files
in 44 minutes, about 1.8 s a file, so a flush is about six minutes -- and a SIGTERM almost always
lands in one. ADR 0051 named this as an accepted consequence for Gmail. For Drive it was the
common case, not the edge.

## Decision

**1. A Google collection settles each item before it asks for the next.** An item's documents
are added and flushed, then its record is released (or refused, if a document's fetch failed),
and only then is the harvest's `next()` called -- where the stop is checked, before and after.
The longest a stop now waits on the Google path is one item's documents: one Drive file, or one
message's attachments.

Every rule ADR 0033 and ADR 0035 put on the ordering is unchanged, because it is the same code
applied to one item instead of a batch: documents before the record, a failed fetch holds the
record back with a refusal, `documentsLanded` counts what the sink got down, and a size refusal
counts as zero. And a stop now keeps more, not less: every item already settled is in the
record sink with its documents down, so the close lands all of them. ADR 0051's stop could only
keep whole chunks.

What still batches is the record sink -- lake writes, projection and the harvest mark, per 200
records. That was never the slow part, and a kill still costs at most one chunk of records.

**2. A run still going when the drain gives up is closed by the stopping process, as cut off.**
`drainJobsBy` (in `services/shutdown.ts`) waits for the jobs in flight until a deadline, and if they
have not settled it closes every `running` run with `RUN_CUT_OFF`: _the worker was shut down (a
deploy or a restart) before this run reached a point where it could stop safely, so the run could
not record its counts; the zeroes are not a count ..._. `server.ts` passes `delay(DRAIN_MS)` as
the deadline, then exits.

The process is alive at that moment and knows it is shutting down, so it is the party that
should say so. `RUN_ABANDONED` at boot then means what its text says: the process died with no
chance to speak -- SIGKILL, the OOM killer, a crash, or a shutdown that could not reach the
database.

The close uses the same repo statement as the boot sweep (`closeAbandoned`, every `running`
row), on the same one-worker premise, which the boot would apply a few seconds later anyway. It
is one short UPDATE inside the 15 s between `DRAIN_MS` and `stop_grace_period`. If it cannot
finish, the boot closes those runs as before. A run that settles before the UPDATE is not
matched. One that settles after it replaces the cut-off with its real outcome and counts, which
is the truer record.

This covers transform and extract runs as well. They are still not told to stop, but one that
outlasts the drain is now closed with the truth rather than left for the boot to call a kill.

## Consequences

- A deploy during a Drive ingest now costs at most the file downloading when SIGTERM arrived,
  and the run settles `RUN_STOPPED` with its real counts. The next run resumes. It lists the
  picks again, and `knownRecords` skips every file whose record is marked harvest-complete with
  an unchanged `modifiedTime`, without downloading it (ADR 0033, ADR 0035).
- A Drive run writes one `raw.documents` upsert per file rather than one per 200 files. At
  1.8 s a download that is noise, and a Gmail message with no attachment writes nothing at all.
- Two waits are still not interruptible, and each ends as a cut-off rather than a stop:
  - **A listing that finds nothing new to read.** On a Drive resumed over thousands of held
    files, or a deep recursive walk, `harvestDrive` pages through listings and probes inside one
    `next()` until it finds a file to download. At one paced request per page of 100 that is
    seconds for a few thousand files, but it has no bound. This is the same case as ADR 0051's
    Gmail listing.
  - **A download backing off on a rate limit.** `GOOGLE_RETRY` sleeps for up to about three
    minutes on a 403 quota.

  Neither is fixed here. Both now end with an honest `RUN_CUT_OFF`.

- The first deploy of this change still behaves the old way, because the process being
  replaced is the old image.

## Options rejected

- **Pass the stop into `landDocuments`, so a flush stops between two downloads.** The stop
  would be seen as quickly, but everything downloaded in that part-flush would be lost with its
  held-back records -- up to 199 files -- and downloaded again next run. It also needs a third
  document outcome, "not reached", beside `landed` and `unfetched`. Today "neither" means
  _refused for size_, and a record released on that basis is marked complete with zero
  documents. A file that was simply not reached, mistaken for that, would be skipped forever
  with none of its bytes in the lake: ADR 0035's loss again, caused by the stop.
- **Raise `DRAIN_MS` and `stop_grace_period`.** Covering a 200-file flush would need about ten
  minutes per deploy, and it still would not be enough for a bigger file or a slower link.
- **A smaller document chunk.** This is the same fix done part of the way. The chunk exists to
  bound memory, and memory is not what was slow.
- **Close only the run ids this process started.** That means passing run ids through every job
  starter (ingest, chained transform, extract) to narrow a scope the boot sweep already treats
  as whole. Reconsider if the worker ever runs as more than one replica. The boot sweep would
  have to change then too.
- **Write the counts at cut-off.** They are in the memory of a job that is still running, and a
  number read partway through `settle` is a count nobody finished. The zeroes are labelled as
  not a count instead, the same as `RUN_ABANDONED`.
- **Edit ADR 0051.** It is accepted. This record supersedes the three sentences named above,
  and the rest of 0051 stands.

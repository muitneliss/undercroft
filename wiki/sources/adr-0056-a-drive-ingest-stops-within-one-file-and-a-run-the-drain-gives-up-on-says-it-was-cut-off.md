---
title: >-
  ADR 0056: A Drive ingest stops within one file, and a run the drain gives up
  on says it was cut off
type: source
date: 2026-09-25
tags: []
source: >-
  docs/adr/0056-a-drive-ingest-stops-within-one-file-and-a-cut-off-run-says-so.md
source_path: >-
  docs/adr/0056-a-drive-ingest-stops-within-one-file-and-a-cut-off-run-says-so.md
source_hash: 2010e354c17cccaf48c48f7690693fcda04767e1133b1f7ee62b3cd8c7721aa3
ingested: 2026-09-25
---

# ADR 0056: A Drive ingest stops within one file, and a run the drain gives up on says it was cut off

Accepted 2026-09-25. Issue #219. It supersedes three sentences of [[ADR 0051: A deploy stops a run at a safe point, and the run keeps its counts]]: that the boot message also covers "a graceful stop that ran out of time"; that a drain which outlasts a transform or an extract leaves them to the boot; and that a full buffer of attachments cannot be interrupted.

**Context.** Three manual Drive ingests of one tenant failed on 2026-09-25. Each was closed at boot with `RUN_ABANDONED` ("killed or ran out of memory"), and no Drive ingest had ever succeeded there. The server showed no OOM kill, `OOMKilled=false` and a 3 GiB limit. Every death matched a release deploy: SIGTERM, then the worker exiting on its own about 45 s later with no SIGKILL. That is `DRAIN_MS` giving up with `drained: false`. The Google path checked the stop only between harvest items, and `collect.ts` held items back 200 at a time, fetching their documents in one flush that ignored the signal. For Gmail that flush is attachments, and many messages have none. For Drive every item is a download: 1,458 files took 44 minutes, about 1.8 s each, so one flush ran about six minutes and a SIGTERM almost always landed inside it.

**Decision.** (1) A Google collection settles each item before it asks for the next. The item's documents are added and flushed, then its record is released, or refused if a fetch failed. Only then is `next()` called, and the stop is checked before and after it. A stop now waits for one Drive file or one message's attachments. The ordering rules from ADR 0033 and [[ADR 0035: A harvest records what it settled, rather than asserting it]] are unchanged. A stop also keeps every settled item, where ADR 0051's stop kept only whole chunks. The record sink still batches 200 records for its lake writes, projection and harvest mark. (2) `drainJobsBy` in `services/shutdown.ts` waits for in-flight jobs until a deadline. If they have not settled, it closes every `running` run with `RUN_CUT_OFF`: the worker was shut down (a deploy or a restart) before the run reached a point where it could stop safely, and its zeroes are not a count. `server.ts` passes `delay(DRAIN_MS)`, then exits. It uses the boot sweep's repo statement and the same one-worker premise, and it fits in the 15 s between `DRAIN_MS` and `stop_grace_period`. A run that settles later overwrites the record with its real outcome. `RUN_ABANDONED` at boot now means only an abrupt death: SIGKILL, OOM, a crash, or a shutdown that could not reach the database. Transform and extract runs that outlast the drain are now closed with the truth too.

**Consequences.** A deploy during a Drive ingest costs at most the file being downloaded, and the run settles `RUN_STOPPED` with real counts. The next run resumes: `knownRecords` skips files that are marked harvest-complete with an unchanged `modifiedTime`, without downloading them. A Drive run now makes one `raw.documents` upsert per file. Two waits still cannot be interrupted, and both now end as an honest cut-off: a listing that finds nothing new (a Drive resumed over thousands of held files, or a deep recursive walk, all inside one `next()`), and a download in `GOOGLE_RETRY` backoff (up to about 3 minutes on a 403 quota). The first deploy of this change still behaves the old way.

**Rejected.** Passing the stop into `landDocuments`: it loses a part-flush of downloads, and it needs a "not reached" document outcome. That outcome could be mistaken for a size refusal and mark a file complete with no bytes, which is ADR 0035's loss again. Also rejected: a longer drain and grace period (about ten minutes per deploy), a smaller document chunk (the chunk bounds memory, not time), closing only this process's run ids (to be revisited if the worker ever has more than one replica), writing counts at cut-off (they live in an unfinished job), and editing ADR 0051.

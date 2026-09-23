# 33. An ingest streams, and does not re-read what it already holds

- Status: Accepted
- Date: 2026-09-22

## Decision

Every ingest path — Gmail, Drive, and the generic spec runtime — reads its source as a stream
and lands each chunk before reading the next. Nothing holds a whole mailbox, a whole folder
tree or a whole entity in memory any more.

Three parts.

**Landing is chunked, and the projection keeps up with it.**
`apps/worker/src/services/landing.ts` holds the two sinks every path now lands through. `add`
buffers to 200 records, flushes through the unchanged `landRecords` / `landDocuments`, projects
that chunk into `raw.records`, and drops the chunk's results into counters. Refusals are written
as they happen rather than held until the run settles, so a run that dies still leaves its
evidence behind.

**A record we already hold is not asked for again.** `knownRecords` answers which of the ids a
listing produced are already in `raw.records`. Gmail skips a message whose id is present; Drive
skips a file whose stored `source_updated_at` still equals the `modifiedTime` the listing
carried. The comparison happens in Postgres, through `unnest($4::text[], $5::timestamptz[])`,
and the function answers a `Set` rather than the stored timestamps — handing a caller a
`timestamptz` rendering leaves it nothing to do but compare in JavaScript against a provider's
ISO string, which is the defect rather than the fix.

**For Gmail, "already held" means already fetched — even if its labels have since changed.**
This is the deliberate trade-off, and it is the one a reader is most likely to think is a bug.
It is recorded in `Cost` below.

Resume falls out of the three rather than being built: there is no checkpoint and no new run
state. A killed run leaves its landed chunks in the lake and in `raw.records`; the next run
projects anything the lake holds that Postgres does not, then declines to re-read it. The same
shape as `pendingDocuments` (ADR 0028) — a work queue derived by asking the data what is
outstanding, which is what survives a SIGKILL when a checkpoint written by the dying process
does not.

## Why

On 2026-09-21 a Gmail ingest of 7,786 messages for one tenant ran for 76 minutes and then lost
all of it. The kernel said why:

```
[Mon Sep 21 15:52:56] bun invoked oom-killer
  constraint=CONSTRAINT_MEMCG  oom_memcg=/system.slice/docker-8dd6e209eee4…
  Killed process (bun) anon-rss:1043524kB
```

`CONSTRAINT_MEMCG` and the container's own cgroup: it hit its declared 1 GiB limit, with 9.5 GB
free on the host. Not a noisy neighbour, and not a limit that wanted raising.

The run's journal shows the shape of the fault exactly. The last line it wrote was
`records_read read=7782 total=7786`; then eight minutes of complete silence; then the process
was gone, with no exception and no stack trace, and `closeAbandonedRuns` reported the corpse at
the next boot. It died in the landing phase, holding everything it had read, having written
nothing durable.

Three things were wrong and all three had to be fixed for any of it to help:

1. **The whole source was buffered before anything was landed.** Every path did it, and
   `runPaths.ts` said so in a docstring that defended it: "a source large enough for that to
   matter would want a different shape, and none is." A 7,786-message mailbox is that source.
2. **The landing phase cost ~90,000 object-store operations.** `LakeStore.read(key, stamp)`
   listed a key whose stamp it had been given, and the loader fetched each manifest twice; with
   `landRecords`' own listing that is roughly four LISTs and eight object operations per record.
   That is what the eight silent minutes were. `ObjectStore.list` now takes a `startAfter` —
   which `keys.ts` and `core/stamp.ts` had both described as the intended design since they were
   written, and neither had implemented — so projecting 7,786 records costs one LIST rather than
   7,787.
3. **Nothing was resumable, so the cost of the crash was the whole 76 minutes.** Re-running
   re-fetched every message at the paced 3 requests/second: 43 minutes before the first byte
   that had not already been read.

**Why the projection must keep up per chunk, and not run at the end.** This was got wrong once
during design and is worth recording. Skipping what we hold reads `raw.records`. If a run only
projects when the entity finishes, a crash at minute 70 leaves 7,786 objects in the lake and
nothing in `raw.records`, and the next run skips nothing — the resume property fails even though
the data is safe. A catch-up pass at the start of a run does not rescue it either: it repairs the
previous crash while setting the current run up to lose everything the same way.

**Two ordering rules, each of which is silent data loss if missed.** Both are pinned by paired
tests, and both were mutation-tested — the guard was broken on purpose and the suite watched to
fail, because a test that cannot fail is not evidence.

- **A Drive file skipped because it was unchanged still enters `seenIds`.** `tombstoneMissing`
  negates the kept-id set, so a file left out of it is reported deleted. Omitting a skipped file
  would tombstone every unchanged file in a tenant's Drive on the second run — a total loss
  presenting as a successful sync.
- **A message's documents land before its record.** Otherwise a message whose attachment fetch
  failed has a record in `raw.records`, and skipping-what-we-hold then skips it forever with the
  attachment never landed. Only a _retryable_ failure holds the record back; a document refused
  for its declared size will be refused identically on every future run, so holding the record
  for it would make the message unharvestable rather than merely incomplete.

Together these make "present in `raw.records`" mean "fully harvested", which is the invariant
that makes skipping safe at all.

**Why a run now says what it skipped.** In steady state an ingest lands nothing, and
`entity_done` reporting `landed: 0` would make "the mailbox is empty" and "nothing changed" the
same green run — the failure mode ADR 0028 was written about, where every layer truthfully
reports success and the feature is still not working. `work_listed` and `entity_done` carry
`skipped`, and the UI renders it as its own sentence.

## Cost

**A Gmail message whose labels changed after it was first read keeps the labels it was read
with**, until something forces a full re-read. This was chosen knowingly. The alternative is to
re-fetch all 7,786 messages on every run to notice a label move, which is the 43 minutes and the
quota pressure that this change exists to remove — and Gmail's `labelIds` is the only field in
the stored record that can change at all, since a sent message's headers and body do not.

The exit, when it is wanted, is Gmail's History API: `historyId` gives exactly the changes since
the last sync, label moves included. It is deliberately not in this change — it expires and so
needs a full-scan fallback anyway, and it is one provider's mechanism where skipping-what-we-hold
is every provider's. It would supersede this paragraph, not the decision.

**`raw.records` is load-bearing for cost now, not only for reading.** It was already a projection
that "may be dropped and rebuilt" (ADR 0001), and that is still true — but dropping it now also
drops the knowledge of what has been fetched, so the next run re-reads the source in full. That
is correct behaviour and it is not free; anyone rebuilding `raw.records` for a large Gmail or
Drive tenant should expect the next sync to cost a first sync.

## Options rejected

- **Raise the worker's memory limit.** It was the first thing suggested and it is the wrong
  lever: the limit is a declared budget on a host shared with other projects
  (`.claude/rules/deployment.md`), and a mailbox twice the size would reach any new number. It
  also leaves the 43-minute re-read and the 90,000 object operations exactly where they were.
- **A run-checkpoint table, and an `interrupted` run status.** The obvious shape once "resume"
  is said out loud. Rejected: a checkpoint is written by the process that is about to be
  SIGKILLed, which is precisely the thing that did not happen on 2026-09-21. Deriving the
  answer from what actually landed cannot lie about it.
- **Skip by id alone for Drive as well as Gmail.** Rejected: a Drive file's content genuinely
  changes in place and `modifiedTime` is already in the listing at no extra cost, so there is no
  reason to be as coarse there as Gmail has to be.
- **Fusing landing and projection to avoid reading back from the lake.** Rejected: the lake is
  deliberately the one source of truth the projection is built from (ADR 0001), and the REST
  lake write API needs the standalone loader regardless. The redundant round trips were removed
  instead.

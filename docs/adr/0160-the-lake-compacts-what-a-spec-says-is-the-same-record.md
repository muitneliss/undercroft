# 160. The lake compacts what a spec says is the same record, and says what it removed

- Status: Accepted
- Date: 2026-11-25
- Follows: [ADR 0158](0158-a-spec-names-the-arrays-that-are-sets.md), whose Consequences left
  "removing the flip-flop history" to "a separate, explicit compaction step that must use
  `canonicalPayload`". This is that step.

## Context

Until ADR 0158, HubSpot's v4 association reads landed a new lake version every time HubSpot
shuffled a set. Measured in production on one tenant: `contact_companies` holds about 6,100
records and about 190,000 superseded versions -- roughly thirty-one each, alternating A, B, A, B
-- with `associations` at about 15,000 and `quote_companies` about 9,000. ADR 0158 stopped new
ones; the old ones are still there.

They are small but not cheap. Every lake object is a directory and an `xl.meta` on MinIO, at
least one 4 KB block each: `records/` is 422 MB of content and 7.1 GB on disk, `_journal/` 313
MB and 6.1 GB. Each redundant version is a manifest and a journal pointer, so removing about
215,000 of them frees on the order of 4-5 GB. Each one also costs a rebuild of `raw.records`
(`journalSince(null)`) a read for nothing.

The raw lake is the only layer that cannot be recomputed (CLAUDE.md, rule 1), and
`raw-lake.md` forbids pruning silently. So removing anything from it needs to say why what it
removes carries no information, which observations it keeps, how it stays clear of the loader,
and where it records what it did.

## Decision

1. **Equivalence is the spec's own declaration, so compaction is lossless.** Two observations
   of a key are the same record exactly when `canonicalPayload(parseLossless(bytes),
entity.unorderedArrays)` gives the same text for both -- the function the runtime has landed
   every record through since ADR 0158. Compaction therefore removes only what ADR 0158 would
   have reported `unchanged` and never written, had it been in force. An entity that declares
   no `unorderedArrays` is never considered. Bytes that do not parse are equal to nothing and
   kept: "could not compare" is not "the same" (rule 2).
2. **What is kept.** In each key's history, an observation is removed only when its canonical
   text equals that of the observation kept immediately before it. So the sequence of distinct
   payloads survives whole -- A, then C, then A again -- each at the stamp it first appeared.
   Always kept, whatever they hold: the **first** observation, and the **last one considered**
   (decision 4), which is the key's newest whenever the loader has passed everything --
   `LakeStore.put` compares a new payload with it, and `raw.records.lake_stamp` names it. What
   is lost is the manifests of the removed ones: the `runId` and `observedAt` of a sync that saw
   the same set again, which is exactly what an `unchanged` put has never recorded either.
3. **The journal goes with the manifest, pointer first.** Each removed observation's journal
   pointer (`_journal/{stream}/{stamp}/{sha12}`) is deleted, then its manifest. Stopped between
   the two, the lake holds an observation nothing points at, which the next run finds
   redundant again and finishes. The other order would leave a pointer to nothing, and a full
   replay -- a rebuild of `raw.records` -- would fail on it.
4. **Nothing the loader has not passed.** Only stamps at or before the stream's
   `raw.load_cursor.last_stamp` are considered, and a stream with no cursor not at all. The
   last of them is kept: it is the observation `raw.records` was projected from.
5. **Not while a run of that (tenant, source) is in progress.** Two loader passes over one
   stream overlap by design (`writeCursor` in `apps/worker/src/repos/rawRecords.ts`), and the
   slower one may hold a journal listing taken before the cursor moved; deleting a pointer
   under it would fail that run. Every loader pass runs inside an `ops.run`, so compaction reads
   the cursor first and then skips a stream whose tenant and source have any run `running`. A
   run that starts after that check starts its passes from a cursor at least as far on, and
   never reads what compaction removes.
6. **Plan, record, then apply; a dry run is the plan.** `LakeStore.planCompaction` decides for
   one key and deletes nothing; `applyCompaction` lists the key again and acts only if the
   observations at or before the cursor are still exactly the ones planned -- a key that moved
   is left for the next run. Each stream's plan, naming every (source key, stamp) it will
   remove, is written to the lake BEFORE anything is deleted, and what was actually removed is
   written beside it after. A run cut off part way has still said what it set out to remove,
   and running it again removes the rest and nothing else, because a removed observation
   equalled the one kept before it and so never decided another's fate. **A dry run is the
   default**; deleting needs `--apply`.
7. **One writer.** Planning, deleting and the report are methods of `LakeStore`, beside
   `prune`. The lake knows nothing of specs: the caller hands it a canonicaliser. The worker's
   `services/lakeCompaction.ts` composes the spec, `canonicalPayload`, the cursor, the run check
   and the store; `lakeCompactionCli.ts` is its composition root.
8. **The report lives in the lake**, under a new reserved prefix, `_reports/lake-compaction/`,
   one create-only object per stream and phase (`plan`, `done`). What it records -- which
   observations left the archive -- must be as durable as the archive; Postgres is a
   projection that may be dropped and rebuilt, and the run journal caps a run at 200 events
   where one stream here names 190,000 removals. The command prints one log line per stream
   with its counts and the two report keys.
9. **No blob garbage collection.** Blobs are untouched, as `prune` leaves them. The flip-flop
   reused two small blobs per record, both still referenced by the observations kept, so a
   collection would free almost nothing here -- and deciding that a blob is unreferenced needs
   a scan of every manifest in the lake, which is a separate decision with its own risks.
10. **Invoked as `task db:lake-compact`**, beside `db:extract-accuracy`, the other worker
    command that reads the lake and a database from outside the stack. It runs where the
    operator is, against the production database and object store reached over SSH tunnels,
    with the worker's own credentials. `docs/runbook/deployment.md`, "Compacting the lake".

## Consequences

- A rebuild of `raw.records` reads about 215,000 fewer journal entries, and the lake gives back
  several gigabytes of MinIO's per-object overhead. The kept history still says when each
  distinct set was first seen.
- `_reports/` is a third reserved prefix. `validateSourceKey` and `validateStream` refuse a key
  under it, as they refuse `_blobs/` and `_journal/`.
- A stream is compacted only up to its cursor. Observations after it -- and the last before it
  -- wait for a later run, which is the price of never touching what the loader has not read.
- `prune`, the retention path, still leaves journal pointers behind. Retention is unbounded in
  production (`RETENTION_UNBOUNDED`), so nothing has met it; anyone who sets a retention must
  fix that first, the way decision 3 does here.

## Options rejected

- **A worker HTTP verb started by a manual Kestra flow.** Runs the released image beside
  MinIO, but a pass over the largest stream outlives Bun's request idle timeout, so it would
  have to answer 202 and run in the background, with its result readable only through the
  object store anyway. That is more moving parts for the same report, and it gives Kestra a
  flow whose only purpose is deleting from raw.
- **A tRPC procedure, and so a CLI command and an MCP tool.** Every procedure becomes an
  assistant and MCP tool (ADR 0029, ADR 0060). An operator's one-off repair of the archive is
  not something a tenant credential or an agent should be able to reach.
- **Compare by digest only.** A and B have different digests; that is the whole problem.
- **Keep only the newest.** Loses the real changes in between -- A, C, A would become A -- and
  the date of the first sighting. Not lossless.
- **Rewrite the kept observations into canonical bytes.** That is an overwrite of the archive,
  which `raw-lake.md` forbids, and it would change what the lake says the source sent.
- **Record the report in `ops.run` and its events.** Capped at 200 events, and a projection.
- **A time margin instead of the run check.** A margin bounds how old an observation is, not
  how old a listing is; a pass's listing is as old as the pass, and the run ledger is what says
  a pass is in flight.

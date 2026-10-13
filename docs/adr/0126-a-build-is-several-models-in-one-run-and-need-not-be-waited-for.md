# 126. A build is several models in one run, and need not be waited for

- Status: Accepted
- Date: 2026-10-13
- Amends: [ADR 0124](0124-a-procedure-that-waits-holds-its-request-to-its-own-cap.md), its
  consequences about `models.build` and the CLI's timeout; everything else in it is unchanged

## Context

Issues #442 and #441, from 2,433 MCP calls in 119 sessions: 261 of 317 `models_build` calls came in
back-to-back streaks (one model per call, the longest 16 in a row), 18 ended with the client's
timeout, and 7 were refused with `CONFLICT`, usually by the agent's own earlier build that had
timed out on its side, with no run id to wait on. The waited answer listed every dbt step, about
300 bytes each, which made `models_build` the largest token sink in the audit.

ADR 0124 gave a procedure that waits a way to hold its request open past Bun's ten-second idle
timeout, and said `models.build` would use it. It did not say for how long, and the CLI's own
request timeout (120 s) was below the control plane's wait on the worker (150 s).

## Decision

1. **`models.build` declares `holdsOpenSeconds: 160`**: the control plane's wait on the worker
   (`BUILD_DEADLINE_MS`, 150 s: the worker's two-minute build, its 20-second wait for a turn inside
   that, then the steps, counts and preview) plus the ten seconds to answer that `runs.get` uses.
   That is under Bun's 255. A shorter hold would cut a build the worker is still legitimately
   running, at the door, and report it as nothing. A longer one would let a hung worker hold a
   socket after nothing is waiting for it. **The CLI's request timeout is 180 s**, above the
   longest hold. `holdOpen.test.ts` pins both procedures that hold.
2. **`wait: false`** answers `{ waited: false, runId }` as soon as the worker has opened the run.
   The build then continues exactly as a waited one would: the same editor turn (ADR 0088), the
   same deadline, the same lock. The caller waits with `runs.get({ runId, waitSeconds })`. The
   waited answer is `{ waited: true, ... }`. It is one output, a discriminated union, rather than
   a second procedure whose input would repeat this one's.
3. **One run for several models.** `names` takes up to 20 selectors. Each is `name`, `+name` or
   `name+`, and nothing else of dbt's grammar. They go to one `dbt build`, one argv item each.
   Every bare name must be a model of the tenant, and that is checked before the worker is called,
   because a selector matching nothing is a green build of nothing. `name` stays for one model.
4. **A refused build names its holder.** The worker's 409 already carried the holder's run id.
   The control plane now reads it, adds `startedAt` from the ledger, and refuses `CONFLICT` with
   both, as facts and in the sentence. A holder the ledger no longer has is not named.
5. **The answer leads with a summary** (#441). It carries `stepSummary`, then the steps `steps`
   asks for (`problems` by default), through the same `reportSteps` as `runs.get`. It also carries
   `rowCounts`: one per named model, counted as the BI login within a ten-second budget shared by
   all of them. A count is `null`, never `0`, for a model that did not build in this run (its
   table, if any, is an earlier build's) or for a count that could not be read. The preview is
   kept for a selection of one model only. A further page of steps is read with `runs.get` on the
   build's run: the cursor belongs to the run, and a build is not repeated just to page.
6. **The worker and control plane tolerate each other's previous build.** They deploy separately.
   The worker reads `model` as a one-model selection. The control plane sends `model` beside
   `select` only when the selection is one plain model, so an older worker never builds less than
   was asked. The answer is parsed, so a missing `rowCounts` reads as none counted.

## Options rejected

- **A separate `models.start` for the build not waited for.** That is two procedures with one input
  to keep in step.
- **dbt's full selector grammar.** `tag:`, `path:`, `@` and wildcards reach further than the names
  show, and cannot be checked against the tenant's models before dbt runs.
- **Counting every model a `+` reached.** It gives figures nobody named, and the caller pays for
  them in time inside a bounded wait.
- **Storing the count in the run's ledger.** A count reads the table now; it is not part of what the
  run recorded.

## Consequences

- Rebuilding N related models is one call and one turn of the tenant's build lock, not N.
- An agent whose host's tool timeout is under 160 s passes `wait: false` and then waits with
  `runs.get`. It never has to hunt for a run id after a timeout.
- A `CONFLICT` on a build gives an agent a run to wait on rather than a reason to retry.

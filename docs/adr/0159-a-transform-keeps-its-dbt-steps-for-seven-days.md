# 159. A transform keeps its dbt steps for seven days

- Status: Accepted
- Date: 2026-11-25
- Follows: [ADR 0039](0039-a-count-has-a-route-to-its-constituents.md) (a prune done by the verb
  that writes the rows, and reported), applied to `ops.run_step`. Keeps the anchors
  [ADR 0129](0129-a-failing-test-is-visible-wherever-the-figure-is-read.md) and
  [ADR 0131](0131-a-build-publishes-only-what-passed.md) read.

## Context

`ops.run_step` holds one row per dbt node per transform run (`090_runs.sql`), cascade-deleted with
its run, and nothing pruned it. Measured on production on 2026-11-25: **2.6M rows, 1.2 GB** (759 MB
heap, 477 MB indexes), growing by **~1.8M rows a month**, about 2.7k steps a transform run. The
server's disk was nearly full.

A run's steps are read while the run is fresh: which model broke, which test found rows. Past
that, the run's own row (`status`, `tests_failed`) and its journal (`dbt_finished` carries the
model, test and failing counts) still say how it went. Five readers touch the steps:

| Reader                                    | Reads                                                                             |
| ----------------------------------------- | --------------------------------------------------------------------------------- |
| `runs.get` (`stepsFor`, `reportSteps`)    | one run's steps and their summary                                                 |
| `lastBuildPerModel` (`models.ts`)         | each model's NEWEST model step, however old                                       |
| `latestTestsPerModel` (`testOutcomes.ts`) | each model's newest served and newest held build, and the tests in the served run |
| `dqFailures` (worker)                     | one test step of one run, to find its stored failing rows                         |
| the Journal and the village (UI)          | `runs.get`'s answer                                                               |

## Decision

1. **A transform run's steps are kept for 7 days from the run's `started_at`**
   (`STEP_RETENTION_DAYS` in `@undercroft/contracts/runs`, one number for the worker and the
   browser). Only step rows go; `ops.run` and its other children stay.

2. **Except while the run is still some model's evidence.** Per model name, the newest run with a
   model step of it, the newest whose build of it was served, and the newest whose build of it was
   held keep their steps however old they are. Without this, a model the schedule does not build
   (built once from the editor, selected out) reads "never built" a week later, its tests read
   `unknown`, and a held build inside the window becomes "the first build of a model that has
   never had a passing version" while its published table is served. Each is a wrong value that
   looks right (rule 2). The three are the readers' own `DISTINCT ON`s, restated in the prune; both
   readers' docstrings point at it. With a schedule that builds every model, every anchor is inside
   the window and the exception keeps nothing.

3. **A run keeps all its steps or none**, so a step list is never a part shown as the whole.

4. **A cleared run says so.** `ops.prune_run_steps` stamps `ops.run.steps_pruned_at`, and `runs.get`
   answers `stepSummary: null` with no steps for such a run, never a summary of zero; the Journal
   prints "this run's dbt steps were cleared after 7 days". A run that recorded no steps (a build
   that broke before dbt ran) is never stamped and still counts zero, which is true. `dqFailures`
   on a cleared run answers `step-not-found`, which it is.

5. **The prune is the transform's own, per tenant, at the end of the run, and reported.** After
   `run_closed`, `pruneSteps` clears that tenant's steps and the run's journal says
   `run_steps_pruned` with `removed`, `runs`, `remaining` and `keptDays` whenever it removed
   anything. Per tenant so the report in a customer's journal counts only that customer's rows,
   and so two prunes of one tenant cannot overlap (two of its builds cannot). A prune that throws
   is `run_steps_prune_failed`, a warning: the run did what it was for, `done` never rejects, and
   the next run tries again.

6. **Bounded per call: whole runs, oldest first, until about 50,000 rows.** About 2.5M rows are
   past the window on production today. One DELETE of all of them at the end of a transform would
   hold the run open for as long as it took and write a GB of WAL in one transaction. A call
   always clears at least one run, so it overshoots by at most one run and never stalls behind a
   run larger than the bound; `remaining` says how many runs it left, so the first prunes read as
   catching up, not as finished. At ~22 transforms a day the backlog clears in two or three days,
   and a steady-state call removes one run's ~2.7k rows.

7. **Grants**: `690_run_step_retention.sql` gives `undercroft_worker` DELETE on `ops.run_step` and
   EXECUTE on the function, which is SECURITY INVOKER like `ops.prune_run_refusals` (250): a
   definer's rights would only hide a missing grant. The worker already holds UPDATE on `ops.run`.

## Options rejected

- **Seven days, full stop.** The user's decision as first stated. It breaks the two per-model
  readers in exactly the "never guess" way above, so the evidence exception is part of this
  decision, not a refinement to come.
- **Keep only the anchor steps themselves**, not their whole run. Smaller, but the old run's step
  list then shows two of its 2,700 steps as if they were all of it.
- **One unbounded DELETE.** Simple, and fine in steady state; the first call on production is the
  problem (decision 6).
- **A scheduler (pg_cron, a Kestra flow).** One statement does not earn one, as ADR 0039 found; the
  transform that writes the steps already runs ~22 times a day.
- **A global prune**, as `ops.prune_run_refusals` is. Its report would land in one customer's
  journal counting another customer's rows.
- **A `stepsPruned` flag beside a zero summary**, as `refusalsPruned` sits beside the rollup. The
  rollup is a true count that survives; a step summary of the empty table is not, so it is `null`.
- **A SECURITY DEFINER function.** Not needed, and it would hide the grant (250's argument).

## Consequences

- `runs.get`'s `stepSummary` is nullable; the procedure sentence, `docs/reference/run-counts.md`
  and the `undercroft` skill say what null means.
- The anchor rule is written twice -- in the readers and in the prune -- and must change together.
  The repo suite pins that an old run that is a model's newest build survives and is what
  `lastBuildPerModel` still answers.
- A DELETE frees space for reuse; it does not shrink the file. Once the backlog is cleared the table
  stops growing; handing the ~1.2 GB back to the host is a one-off `VACUUM FULL ops.run_step` an
  operator chooses to run, not automated, because it locks the table while it rewrites it.
- A deactivated customer runs no transform, so its old steps stay until it is reactivated or
  removed. They no longer grow either.

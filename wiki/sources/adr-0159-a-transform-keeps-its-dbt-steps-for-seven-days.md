---
title: ADR 0159 A Transform Keeps Its dbt Steps for Seven Days
type: source
date: 2026-11-25
tags: []
source: docs/adr/0159-a-transform-keeps-its-dbt-steps-for-seven-days.md
source_path: docs/adr/0159-a-transform-keeps-its-dbt-steps-for-seven-days.md
source_hash: e4ab5b7f8507e32169b9f3ede3945c901d5e770532499b32791f10f2a77123ec
ingested: 2026-11-25
---

# ADR 0159 A Transform Keeps Its dbt Steps for Seven Days

Applies [[ADR 0039 A Count Has a Route to Its Constituents]]'s prune shape -- done by the verb that writes the rows, and reported -- to `ops.run_step`, and keeps the anchors [[ADR 0129 A Failing Test Is Visible Wherever the Figure Is Read]] and [[ADR 0131 A Build Publishes Only What Passed]] read.

**Why.** `ops.run_step` holds one row per dbt node per transform run and nothing pruned it: measured on production on 2026-11-25 at 2.6M rows, 1.2 GB (759 MB heap, 477 MB indexes), growing \~1.8M rows a month (\~2.7k steps a run), with the server's disk nearly full. Past the first days a run's own row (`status`, `tests_failed`) and its journal (`dbt_finished`) still say how it went.

**Seven days, judged by the run's `started_at`** (`STEP_RETENTION_DAYS` in `@undercroft/contracts/runs`). Only step rows go; `ops.run` and its other children stay.

**Except a run that is still a model's evidence.** Per model name, the newest run with a model step of it, the newest whose build of it was served, and the newest whose build of it was held keep their steps however old. Otherwise a model the schedule does not build would read "never built", its tests `unknown`, and a held build inside the window would become "never had a passing version" while its published table is served. The rule restates `lastBuildPerModel`'s and `latestTestsPerModel`'s `DISTINCT ON`s; both point at it. A run keeps all its steps or none.

**A cleared run says so.** `ops.prune_run_steps` (`690_run_step_retention.sql`) stamps `ops.run.steps_pruned_at`; `runs.get` then answers `stepSummary: null` with no steps, never a summary of zero, and the Journal prints that the steps were cleared after 7 days. A run that recorded no steps is never stamped and still counts zero.

**Per tenant, at the end of each transform, bounded and reported.** After `run_closed`, `pruneSteps` clears whole runs of that tenant, oldest first, until about 50,000 rows (always at least one run), and the journal says `run_steps_pruned` with `removed`, `runs`, `remaining` and `keptDays`; a failure is the warning `run_steps_prune_failed` and never fails the run. The bound exists because \~2.5M rows were past the window on production: one DELETE would hold the run open and write a GB of WAL in one transaction; batched, the backlog clears in two or three days of ordinary runs. The worker gets DELETE on `ops.run_step`; the function is SECURITY INVOKER.

Rejected: seven days with no exception (wrong values on two readers), keeping only the anchor steps (a partial list shown as whole), one unbounded DELETE, a scheduler, a global prune (its report would count another customer's rows), a `stepsPruned` flag beside a zero summary, and SECURITY DEFINER. Consequences: `stepSummary` is nullable; the anchor rule lives in two places that change together; a DELETE does not shrink the file, so returning the 1.2 GB is a one-off `VACUUM FULL` an operator chooses.

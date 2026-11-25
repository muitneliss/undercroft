-- A run's dbt steps are kept for 7 days, and a pruned run says so. ADR 0159.
--
-- WHY. `ops.run_step` holds one row per dbt node per transform run, and nothing pruned it.
-- Measured on production on 2026-11-25: 2.6M rows, 1.2 GB (759 MB heap, 477 MB indexes), growing
-- by ~1.8M rows a month -- ~2.7k steps a run -- on a host whose disk was nearly full. A run's
-- steps are read while it is fresh: which step failed, which test found rows. A month later
-- the run's own counts (`ops.run`: `tests_failed`, the status) and its journal (`dbt_finished`
-- carries the model and test counts) still answer "how did it go"; the per-node rows do not
-- earn 40 MB a day.
--
-- WHAT IS KEPT PAST THE WINDOW, AND WHY IT IS NOT "7 DAYS, FULL STOP". Two readers anchor on the
-- NEWEST step of a model however old it is: `lastBuildPerModel` (the editor's "last build" mark)
-- and `latestTestsPerModel` (a model's test state, ADR 0129, and its published build, ADR 0131).
-- A model the schedule does not build -- built once from the editor, or selected out -- has its
-- newest step older than a week. Prune that and the model reads "never built", its tests
-- "unknown", and, worse, a held build inside the window becomes "the first build of a model
-- that has never had a passing version" while its published table is being served. Each of
-- those is a wrong value that looks right (CLAUDE.md rule 2). So a run that is still some
-- model's evidence keeps its steps: per model name, the newest run with a model step of it, the
-- newest whose build of it was served, and the newest whose build of it was held. The three
-- are the readers' own `DISTINCT ON`s, restated here; `testOutcomes.ts` and `models.ts` point
-- back at this file. A run keeps ALL its steps or none, so a run's step list is never a part
-- shown as the whole. With a schedule that builds every model, every anchor is inside the
-- window and the exception keeps nothing.
--
-- A PRUNED RUN SAYS SO. `ops.run.steps_pruned_at` is stamped on a run whose steps this removed,
-- so `runs.get` answers its step summary with null -- "cleared" -- rather than counting an empty
-- table as "0 steps". It is an observation, set only by the prune: a run that recorded no steps
-- (a build that failed before dbt ran) stays NULL, because claiming its detail was cleared would
-- invent a history for it (the same care as `refusalsPruned`, ADR 0039).
--
-- BOUNDED PER CALL, BECAUSE THE FIRST CALL MEETS THE BACKLOG. ~2.5M rows are older than 7 days
-- today. One DELETE of all of them, at the end of a transform run, would hold the run open for
-- as long as it took and write a GB of WAL in one transaction. So a call clears whole runs,
-- oldest first, until it has removed `max_rows` (it always clears at least one run, so it can
-- overshoot by one run's size and never stalls on a run larger than the bound), and answers how
-- many candidate runs it left. The worker passes 50,000: a steady-state call removes one run's
-- ~2.7k, and the backlog is cleared over a few days of ordinary runs. It is per tenant, called
-- by that tenant's transform, so its report in that run's journal counts only that tenant's
-- rows, and two prunes of one tenant cannot overlap because two of its builds cannot.
--
-- DISK. A DELETE frees space for reuse, it does not shrink the file: after the backlog is
-- cleared the table stops growing, and handing the 1.2 GB back to the host is a one-off
-- `VACUUM FULL ops.run_step` by an operator, deliberately not automated: it takes an exclusive
-- lock on the table for as long as it rewrites it.

ALTER TABLE ops.run ADD COLUMN IF NOT EXISTS steps_pruned_at timestamptz;

/**
 * Clear the steps of one tenant's transform runs that started more than `keep_days` ago and are
 * no model's evidence, at most about `max_rows` rows, oldest run first; answer how many rows
 * went, from how many runs, and how many such runs are still left for a later call.
 *
 * SECURITY INVOKER, as `ops.prune_run_refusals` is (250): the worker holds the DELETE itself
 * (granted below), so a definer's rights would only hide a missing grant.
 */
CREATE OR REPLACE FUNCTION ops.prune_run_steps(for_tenant text, keep_days integer, max_rows integer)
RETURNS TABLE (removed integer, cleared_runs integer, remaining_runs integer)
LANGUAGE plpgsql
AS $$
DECLARE
    cleared text[];
BEGIN
    WITH model_steps AS (
        SELECT s.name, s.run_id, r.started_at,
               -- Served and held exactly as `latestTestsPerModel` reads them (ADR 0131).
               (s.promoted IS TRUE OR (s.promoted IS NULL AND s.status = 'success')) AS served,
               s.promoted IS FALSE AS held
          FROM ops.run_step s JOIN ops.run r ON r.id = s.run_id
         WHERE r.tenant_id = for_tenant AND r.verb = 'transform' AND s.kind = 'model'
    ),
    evidence AS (
        (SELECT DISTINCT ON (name) run_id FROM model_steps
          ORDER BY name, started_at DESC, run_id DESC)
        UNION
        (SELECT DISTINCT ON (name) run_id FROM model_steps WHERE served
          ORDER BY name, started_at DESC, run_id DESC)
        UNION
        (SELECT DISTINCT ON (name) run_id FROM model_steps WHERE held
          ORDER BY name, started_at DESC, run_id DESC)
    ),
    candidates AS (
        SELECT r.id, r.started_at,
               (SELECT count(*) FROM ops.run_step s WHERE s.run_id = r.id) AS steps
          FROM ops.run r
         WHERE r.tenant_id = for_tenant
           AND r.verb = 'transform'
           AND r.status <> 'running'
           AND r.steps_pruned_at IS NULL
           AND r.started_at < now() - make_interval(days => keep_days)
           AND r.id NOT IN (SELECT run_id FROM evidence)
    ),
    ordered AS (
        SELECT id, steps, sum(steps) OVER (ORDER BY started_at, id) AS through
          FROM candidates
         WHERE steps > 0
    )
    SELECT coalesce(array_agg(id) FILTER (WHERE through - steps < max_rows), '{}'),
           count(*) FILTER (WHERE through - steps >= max_rows)
      INTO cleared, remaining_runs
      FROM ordered;

    DELETE FROM ops.run_step WHERE run_id = ANY (cleared);
    GET DIAGNOSTICS removed = ROW_COUNT;
    UPDATE ops.run SET steps_pruned_at = now() WHERE id = ANY (cleared);
    cleared_runs := cardinality(cleared);
    RETURN NEXT;
END;
$$;

-- THE WORKER NEEDS DELETE ON `ops.run_step` NOW, AND DID NOT BEFORE: 090 gave it SELECT, INSERT,
-- UPDATE because it only ever wrote steps. Same move, and same reason, as 250's DELETE on
-- `ops.run_refusal`. It already holds UPDATE on `ops.run`, which the stamp needs.
GRANT DELETE ON ops.run_step TO undercroft_worker;
GRANT EXECUTE ON FUNCTION ops.prune_run_steps(text, integer, integer) TO undercroft_worker;

-- BI keeps its 040 read on ops.run; the new column falls under that table-level grant, and a
-- timestamp of when detail was cleared is the same category as `ended_at` beside it.

-- What a run's numbers MEAN, so the answer is in the browser and not in an SSH session.
--
-- On 2026-09-22 an operator read "255 bản ghi · 245 bị từ chối" off a run's flow rail and had
-- no way to find out what the 245 were. Seven psql queries later the answer was: 230 email
-- signature images under the OCR size gate, 14 blank scans, one legacy `.doc` -- a healthy run
-- draining a backlog left by a deploy four minutes earlier. Every one of those queries is a
-- thing the ledger already almost knew. Three columns and one table close the gap.
--
-- `ops.run_refusal_reason` IS THE ROLLUP, AND IT OUTLIVES THE RECORDS. `ops.run_refusal` holds
-- one row per refused record and is pruned at 7 days (see the retention note below); this holds
-- one row per DISTINCT REASON and is never pruned. The split is the whole point: without it, a
-- run older than the retention window prints `refused: 245` over an empty table -- which is
-- exactly the defect this migration exists to fix, merely time-delayed. With it, the reader
-- still sees "230 × image-too-small-to-read" a year later and loses only the individual
-- document ids, which is almost never what was wanted. The cost is ~3-8 rows per run against
-- ~245, so the permanent half is the cheap half.
--
-- `pending_before` IS AN OBSERVATION, NOT A DERIVATION. It is how much work was outstanding when
-- THIS run drew its batch, and it is stored rather than recomputed because recomputing it later
-- answers a question about today and dates the answer wrongly to the past. A run that refused
-- 245 while draining a backlog of 2,337 is healthy; the identical 245 with nothing behind it is
-- a fault, and the two must not render alike. NULL means "this verb has no backlog to report",
-- which is every verb but `extract` today -- never 0, which would claim the queue was empty.
--
-- `release_tag` IS WHICH BUILD PRODUCED THE ROW. Spelled with the suffix because RELEASE is a
-- SQL keyword (RELEASE SAVEPOINT) and a bare column of that name is a quoting trap for every
-- future statement. It is stamped from the image rather than from the deploy pointer: CI pushes
-- `v1.16.0` AND `latest`, and Dokploy tracks `latest` deliberately so there is no version to
-- keep in sync by hand -- which means the pointer carries no version and the version has to ride
-- inside the artifact. `''` is "this build did not say", never a guessed value.
--
-- RETENTION IS THE APPLICATION'S, AND IT IS OPPORTUNISTIC. There is no pg_cron here and no
-- scheduler worth adding for one DELETE: `ops.prune_run_refusals` is called by the verb that
-- writes the rows, the same shape as `pruneExpiredHandshakes` in the control plane, and it
-- RETURNS what it removed so the caller can report it. A store that prunes silently is
-- indistinguishable from one that loses data (`raw-lake.md`), and that rule does not stop being
-- true because this is a projection rather than the lake.

ALTER TABLE ops.run
    ADD COLUMN IF NOT EXISTS release_tag    text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS pending_before integer;

-- One row per (run, entity, reason). PRIMARY KEY rather than an index, because a second row for
-- the same reason in one run is not a fact -- it is the same fact counted twice.
CREATE TABLE IF NOT EXISTS ops.run_refusal_reason (
    run_id  text    NOT NULL REFERENCES ops.run(id) ON DELETE CASCADE,
    entity  text    NOT NULL,
    reason  text    NOT NULL,
    count   integer NOT NULL,
    PRIMARY KEY (run_id, entity, reason)
);

/**
 * Drop per-record refusals older than `keep_days`, and say how many went.
 *
 * SECURITY INVOKER, deliberately: the worker holds DELETE on ops.run_refusal already (090), so
 * this needs no elevation, and a SECURITY DEFINER function that deletes rows is a thing to
 * write only when there is no other way. The rollup is untouched by construction -- it is a
 * different table, and that is the entire reason it is a different table.
 */
CREATE OR REPLACE FUNCTION ops.prune_run_refusals(keep_days integer)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    removed integer;
BEGIN
    DELETE FROM ops.run_refusal
     WHERE at < now() - make_interval(days => keep_days);
    GET DIAGNOSTICS removed = ROW_COUNT;
    RETURN removed;
END;
$$;

-- The worker writes the rollup and reads nothing back; the control plane reads it to draw the
-- band and may delete a run's rollup with the run. Same split as ops.run_entity in 090.
-- `privileges.md`: a migration that creates a table grants that table in the same file, because
-- `040_grants.sql` said ON ALL TABLES and can never run again.
GRANT SELECT, INSERT, UPDATE ON ops.run_refusal_reason TO undercroft_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON ops.run_refusal_reason TO undercroft_app;
GRANT EXECUTE ON FUNCTION ops.prune_run_refusals(integer) TO undercroft_worker;

-- THE WORKER NEEDS DELETE ON `ops.run_refusal` NOW, AND DID NOT BEFORE. 090 granted it
-- `SELECT, INSERT` with the comment "refusals are only ever appended", which was exactly right
-- until this file gave the appending verb the job of pruning too. The function is SECURITY
-- INVOKER deliberately -- a SECURITY DEFINER wrapper would have hidden the missing privilege
-- behind the migration role's own rights, which is how a grant model stops describing what
-- callers may actually do. Caught by `runs.test.ts` running as `undercroft_worker` rather than
-- at 02:00 as "permission denied for table run_refusal" (`tests.md`).
GRANT DELETE ON ops.run_refusal TO undercroft_worker;

-- BI keeps its 040 read on ops.run and gets nothing below it, unchanged. The two new COLUMNS on
-- ops.run do fall under that existing table-level grant (a column added later inherits the
-- relation's ACL -- see the note in 240), and that is correct here: a release tag and a queue
-- depth are counts and versions, the same category as `created` and `refused` beside them, and
-- neither can carry a name a human wrote.

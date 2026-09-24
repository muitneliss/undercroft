-- ops.run.notice = 'recovered': a successful run that ended a failure somebody was told about.
--
-- The control plane posts a sync's failure to the operators' Lark group, and posts again when
-- the pair next succeeds, so a red card in the group is never the last word on a sync that has
-- since come back. That second card needs the same at-most-once claim the first one has
-- (110_alerts.sql): one UPDATE that marks the successful run and returns it. `notice` already
-- is that claim for a failure, so the recovery is a third value of it rather than a second
-- column -- a column that could only ever be set on an `ok` run while `notice` could only be
-- set on a `failed` one would be two columns saying one thing.
--
-- A value added to the CHECK only; no row changes. `claimFailedRuns` counts a pair's earlier
-- notice only when it is 'sent', so a 'recovered' row never suppresses anything.

ALTER TABLE ops.run DROP CONSTRAINT IF EXISTS run_notice_check;
ALTER TABLE ops.run
    ADD CONSTRAINT run_notice_check CHECK (notice IN ('sent', 'suppressed', 'recovered'));

-- NO NEW GRANT. The control plane holds UPDATE on every table in `ops` (110_alerts.sql), which
-- is what claims a failure today.

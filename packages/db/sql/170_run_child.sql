-- A run's chained child, findable without a scan.
--
-- ops.run.parent_run_id has named a run's parent since 090, but nothing ever read it in the
-- other direction: given an ingest, which build did it trigger (jobs.ts's startIngestJob)?
-- Without an index that is a sequential scan of the tenant's whole history on every
-- `runs.get` -- called on every row a reader opens in the journal, and polled while a run is
-- live. Most rows have no parent, so a partial index keeps it to the ones that do.

CREATE INDEX IF NOT EXISTS run_parent ON ops.run (parent_run_id) WHERE parent_run_id IS NOT NULL;

-- A build's steps may be seed loads too. ADR 0128.
--
-- `dbt build` loads every seed its selection reaches before the models that read it, and
-- reports each load as a node of its own in `run_results.json`. The ledger kept only model and
-- test steps (090), so a seed that failed to load left no step behind and the build read as
-- clean; the worker now records it, as `seed`, and a failed one fails the run.
--
-- The inline CHECK of 090 is named by Postgres's own rule, `<table>_<column>_check`.

ALTER TABLE ops.run_step DROP CONSTRAINT IF EXISTS run_step_kind_check;
ALTER TABLE ops.run_step
    ADD CONSTRAINT run_step_kind_check CHECK (kind IN ('model', 'test', 'seed'));

-- Which model a dbt test step tests. ADR 0129.
--
-- A test step's own name says it only by a naming convention that is ambiguous (`not_null_a_b_c`
-- is column `b_c` of `a` or column `c` of `a_b`) and that dbt hashes past 63 characters. dbt's
-- manifest says it exactly: a generic test's `attached_node`, else the one model it depends on.
-- The worker reads it after each build and writes it here, so "what are this model's latest
-- tests" is a join on a column rather than a guess about a name.
--
-- NULL for a model step, for a test the manifest could not attribute to exactly one model, and
-- for every step recorded before this file. A model whose tests have no attributed row reads as
-- tests "unknown", never as passing (CLAUDE.md rule 2); its next build attributes them.
--
-- No grant moves: the worker already upserts ops.run_step and the control plane reads it.

ALTER TABLE ops.run_step ADD COLUMN IF NOT EXISTS model text;

CREATE INDEX IF NOT EXISTS run_step_tested_model ON ops.run_step (run_id, model)
    WHERE kind = 'test' AND model IS NOT NULL;

-- Drop the run ledger.
--
-- ADR 0007 records the decision and what it gives up. In short: the ledger was
-- carried over from the legacy system's `wa-observability` work, arrived here in
-- "Phase 0: observability core" without a decision of its own, and the owner has
-- decided the new platform does not need it.
--
-- WHY A DROP RATHER THAN EDITING 001. Migration 001 has been applied to a
-- deployed database, so removing the CREATE from it would leave the table in
-- place on every existing environment while new ones never got it -- drift that
-- only shows up when someone queries it. Migrations are history; this one is the
-- reversal, stated as its own step.
--
-- WHAT GOES WITH IT. `vcdo alerts`, flows/run_health.yml and the control plane's
-- run-history screen were all readers of this table and have been removed in the
-- same change. Nothing else queries it.
--
-- WHAT STAYS, and deliberately:
--
--   ops.generation    which run is currently serving. A different question --
--                     publish atomicity, not row accounting -- and the thing
--                     that keeps a failed run from half-replacing a good one.
--   ops.gate_finding  the Xero reconciliation gate's findings, and identity
--                     conflicts from the crosswalk. Still written, still read.
--   dq.quarantine     rejected rows with their reason and payload. This is now
--                     the ONLY per-row record of something the pipeline refused,
--                     which makes it more load-bearing than it was, not less.
--
-- WHAT IS LOST. Nothing now checks that rows read minus rows stored minus rows
-- excluded balances to zero. A source that returns *nothing* still fails loudly
-- (`land()` raises on zero records). A source that returns *less than it should*
-- no longer does.

BEGIN;

DROP TABLE IF EXISTS ops.run_ledger;

COMMIT;

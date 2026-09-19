-- A cadence on every connection: how often it is read, in one of four words.
--
-- Kestra owns the tick and nothing in this database can make a cron expression fire, so a
-- cron column would be a promise nobody keeps. What the scheduler needs is a lower bound on
-- the gap between two runs, chosen by a customer's administrator from a short list; what a
-- card needs is the same word back. `packages/contracts/src/cadence.ts` is the one place
-- that turns the word into a time.
--
-- `daily` by default, so a connection made before this column existed keeps roughly the
-- schedule the old flow gave it. `paused` is a cadence rather than a status: a paused source
-- is still connected, its grant still stands, and the card still says so.
--
-- No new grant: a table-level grant covers a column added later, and the app already holds
-- UPDATE on ops.connection as the worker holds SELECT (both in 040_grants.sql).

ALTER TABLE ops.connection
    ADD COLUMN IF NOT EXISTS cadence text NOT NULL DEFAULT 'daily'
        CHECK (cadence IN ('hourly', 'every_6h', 'daily', 'paused'));

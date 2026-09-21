-- A progress line is a GAUGE, not an entry: one row per (run, event, entity), updated.
--
-- 160 made this table append-only and said so in as many words, and for a milestone that is
-- still exactly right: "the run opened", "messages finished", "dbt built 14 models" are things
-- that HAPPENED, at an instant, and a ledger that could rewrite them would not be a ledger.
--
-- A progress line is not one of those. "Read 928 of 7,786 messages" is a reading of a dial, and
-- the next reading does not add to it -- it replaces it. The worker has always treated it that
-- way: `runJournal.progress` drops a line whose predecessor is less than an interval old, and
-- its docstring already argues why that is not pruning ("the line it replaces said the same
-- thing about the same entity a moment ago, and the next one will say it again"). This carries
-- the same argument one step further, from "drop the one too soon" to "there is only ever one".
--
-- WHAT IT FIXES. The run cap is 200 events, which a milestone can never reach and a progress
-- line reaches in minutes: an ingest over a real mailbox ran for hours with its counter frozen
-- at whatever the two-hundredth line had said, because every line after it was refused. Lifting
-- the cap instead would have made a three-hour run write thousands of rows per entity -- "it
-- must not become the thing it is describing" -- and the feed's own read returns the newest 300,
-- so a run's opening milestones would have been evicted by its own progress. Superseding is the
-- shape that is bounded in ROWS and unbounded in TIME, which is what a live counter needs.
--
-- WHAT IT DOES NOT LOOSEN. `live` is set by one call path (`RunJournal.progress`) and the
-- grant below is column-scoped to the two columns a reading updates, so a milestone, a level, an
-- event name and an entity remain unwritable once recorded, exactly as 160 says. `raw` is
-- untouched: the durable-layer rule is about the lake, and `ops.run_event` is a projection that
-- may be dropped with its run. ADR 0032.
--
-- HISTORY IS NOT REWRITTEN. No backfill: every row already in this table stays `live = false`
-- and keeps reading as it was recorded. A run that narrated itself 180 times still says so.

ALTER TABLE ops.run_event ADD COLUMN IF NOT EXISTS live boolean NOT NULL DEFAULT false;

-- The uniqueness that makes `ON CONFLICT` possible, and the reason a second reading updates
-- rather than appends. Partial, so it constrains only the live rows and leaves every appended
-- milestone -- including the ones already here -- free to repeat. `coalesce` because a run-wide
-- progress line has no entity, and two NULLs are not equal to each other.
CREATE UNIQUE INDEX IF NOT EXISTS run_event_live_one
    ON ops.run_event (run_id, event, coalesce(entity, ''))
    WHERE live;

-- The only edit the worker may make: a newer reading of a dial it already wrote. It cannot
-- change what an event IS, only what it currently says and when it last said it -- the same
-- column-scoped shape `app.ingest_key` and `app.model` already use, and the reason
-- `.claude/rules/privileges.md` insists a verb's grant names its columns.
GRANT UPDATE (at, detail) ON ops.run_event TO undercroft_worker;

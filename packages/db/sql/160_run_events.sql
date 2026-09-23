-- ops.run_event: what a run is DOING, while it is still doing it.
--
-- The three tables in 090 record what a run turned out to have done, and they are written
-- when it closes. That is the right shape for an audit and the wrong shape for somebody
-- watching: an ingest that reads a mailbox one message at a time is minutes or hours of a
-- row that says `running` and five columns that say nothing, and the only evidence of
-- progress -- the worker's JSONL on stdout -- is inside a container the control plane has no
-- path to. A green run that landed nothing is the same problem after the fact: "0" is true
-- and says neither "the folder held no PDFs" nor "this customer has no models to build".
--
-- So the worker appends a small, ENUMERATED event here as it goes, and the journal reads it.
--
--   event   a verb from a fixed set the interface has a sentence for, never free prose
--   detail  counts and opaque provider ids, and nothing else
--
-- `detail` is where the discipline lives. This table is in `ops`, one `dbt run` from a
-- dashboard if anybody ever grants it, and a log line is the least controlled surface there
-- is -- a filename, a mail subject or a folder name would be in it within a release. Those
-- belong in the lake manifest (.claude/rules/pii.md, ADR 0015). The grants below are
-- ops.run_refusal's, deliberately: neither BI nor any dbt role is given anything at all.
--
-- Bounded per run by the worker rather than by a trigger, and the truncation is itself an
-- event: a store that prunes without saying so is indistinguishable from one that lost the
-- rows (.claude/rules/raw-lake.md).

CREATE TABLE IF NOT EXISTS ops.run_event (
    id     bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id text        NOT NULL REFERENCES ops.run(id) ON DELETE CASCADE,
    at     timestamptz NOT NULL DEFAULT now(),
    level  text        NOT NULL CHECK (level IN ('info', 'warn', 'error')),
    event  text        NOT NULL CHECK (length(event) BETWEEN 1 AND 60),
    -- The entity it concerns, where it concerns one. NULL is "the run as a whole".
    entity text,
    detail jsonb       NOT NULL DEFAULT '{}'::jsonb
);
-- The one read there is: a run's feed, in the order it happened.
CREATE INDEX IF NOT EXISTS run_event_run ON ops.run_event (run_id, id);

-- The worker appends; it never edits or removes an event, for the same reason it never
-- edits a refusal. The control plane reads, and may delete a run's feed with the run.
--
-- ONE EXCEPTION, ADDED IN 210: a PROGRESS line is a reading of a dial rather than a thing that
-- happened, so it keeps one row per (run, event, entity) and the worker updates it in place,
-- under a column-scoped UPDATE grant reaching `at` and `detail` and nothing else. The sentence
-- above still holds for every milestone, and for what an event IS. ADR 0032.
GRANT SELECT, INSERT ON ops.run_event TO undercroft_worker;
GRANT SELECT, DELETE ON ops.run_event TO undercroft_app;
GRANT USAGE ON SEQUENCE ops.run_event_id_seq TO undercroft_worker;

-- The run ledger: ops.run gets a writer, and the rows a run refuses get a table.
--
-- ops.run existed since 020 and nothing ever wrote it, so a run that landed nothing left no
-- trace and a run that failed left less. CLAUDE.md rule 2 says a row the pipeline refuses is
-- recorded with its reason rather than dropped; until now the reason lived in an HTTP body
-- the caller discarded. Three tables close that:
--
--   ops.run_entity   what one run did per entity (the numbers on the card and the ledger)
--   ops.run_refusal  each record or document a run refused, with why -- never the payload
--   ops.run_step     one row per dbt node from run_results.json (models and tests)
--
-- Concurrency belongs in SQL: `run_one_running` is what makes "one run per (tenant, source,
-- verb) at a time" true for every caller at once, rather than a check in one loader.
--
-- `triggered_by` is a uuid, never an address, and `error` carries a ConnectorError's message
-- (counts and detail, never a row), because ops.run is readable by the BI role. The side
-- tables are not: a refusal reason can quote a payload key.

ALTER TABLE ops.run
    ADD COLUMN IF NOT EXISTS trigger      text NOT NULL DEFAULT 'schedule'
        CHECK (trigger IN ('schedule', 'manual', 'build', 'lake-api')),
    ADD COLUMN IF NOT EXISTS triggered_by text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS parent_run_id text,
    ADD COLUMN IF NOT EXISTS refused      integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS tests_failed integer,
    ADD COLUMN IF NOT EXISTS error        text,
    ADD COLUMN IF NOT EXISTS notified_at  timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS run_one_running
    ON ops.run (tenant_id, source, verb) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS run_tenant_started ON ops.run (tenant_id, started_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS ops.run_entity (
    run_id    text NOT NULL REFERENCES ops.run(id) ON DELETE CASCADE,
    entity    text NOT NULL,
    landed    integer NOT NULL DEFAULT 0,   -- reached the lake (new or unchanged)
    created   integer NOT NULL DEFAULT 0,   -- projected into raw as new rows
    changed   integer NOT NULL DEFAULT 0,   -- projected into raw as changed rows
    unchanged integer NOT NULL DEFAULT 0,   -- already in raw, byte-identical
    refused   integer NOT NULL DEFAULT 0,   -- see ops.run_refusal
    PRIMARY KEY (run_id, entity)
);

CREATE TABLE IF NOT EXISTS ops.run_refusal (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id           text NOT NULL REFERENCES ops.run(id) ON DELETE CASCADE,
    entity           text NOT NULL,
    source_record_id text NOT NULL,
    reason           text NOT NULL,
    at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS run_refusal_run ON ops.run_refusal (run_id, id);

CREATE TABLE IF NOT EXISTS ops.run_step (
    run_id       text NOT NULL REFERENCES ops.run(id) ON DELETE CASCADE,
    unique_id    text NOT NULL,
    kind         text NOT NULL CHECK (kind IN ('model', 'test')),
    name         text NOT NULL,
    status       text NOT NULL,
    failures     integer,
    relation     text,
    message      text,
    execution_ms integer,
    PRIMARY KEY (run_id, unique_id)
);

-- The worker writes a run and everything under it; the control plane reads all of it and
-- may delete a run (nothing does yet). BI keeps its 040 read on ops.run and gets nothing
-- below it.
GRANT SELECT, INSERT, UPDATE ON ops.run TO undercroft_worker;
-- UPDATE on the two tables the worker upserts into (a resumed entity adds to its counts, a
-- re-run step replaces its status); refusals are only ever appended.
GRANT SELECT, INSERT, UPDATE ON ops.run_entity, ops.run_step TO undercroft_worker;
GRANT SELECT, INSERT ON ops.run_refusal TO undercroft_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON ops.run_entity, ops.run_refusal, ops.run_step TO undercroft_app;
GRANT USAGE ON SEQUENCE ops.run_refusal_id_seq TO undercroft_worker, undercroft_app;

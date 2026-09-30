-- The scope a run read with, kept with the run. ADR 0091, #346.
--
-- An admin's choice of what a connection reads lives in `app.connection_detail.selection`, and a
-- save overwrites it. So a run's leaf could only ever show TODAY's choice beside a run that read
-- with yesterday's, and a Drive run from before a folder was dropped would claim it had read
-- without that folder. The choice is an observation about the run, and like `pending_before`
-- (250) it is stored when it is observed rather than recomputed later, because recomputing it
-- answers a question about today and dates the answer to the past (ADR 0039).
--
-- WHY A TABLE IN `app` AND NOT A COLUMN ON `ops.run`. `040_grants.sql` grants
-- `SELECT ON ops.run TO undercroft_bi`, and a table-level grant covers a column added later
-- (see the note in 240). The selection carries names a person wrote -- a Gmail label, a Drive
-- folder, a Xero organisation -- which is exactly why `070_google_ingestion.sql` put it in `app`,
-- the one schema BI has no USAGE on. A copy of it on `ops.run` would put those names one
-- dashboard from any BI login, permanently and silently. So the copy lives beside the original,
-- under the same boundary, keyed by the run.
--
-- ONE ROW PER RUN, WRITTEN ONCE. The worker writes the row the first time a run reads its scope
-- (`scopeForRun` in `packages/db/src/repos/runs.ts`) and every later read in that run gets the
-- row back, so the scope on the leaf IS the scope the run read with -- not a copy taken beside
-- the read that could disagree with it. `ON CONFLICT DO NOTHING` in that statement is the guard;
-- the worker holds no UPDATE here, which makes "a run's scope is never rewritten" a privilege
-- rather than a convention.
--
-- NO ROW is "not recorded": every run from before this file, and every run that reads no scope
-- (a lake-API batch, a transform, an extract). The leaf prints an em dash for it, never the
-- connection's scope today. A row whose `selection` is NULL is a different fact: the run did read
-- its scope, and the connection had none chosen -- a HubSpot connection nobody has scoped, which
-- reads the spec's own properties.

CREATE TABLE IF NOT EXISTS app.run_scope (
    run_id    text        PRIMARY KEY REFERENCES ops.run(id) ON DELETE CASCADE,
    selection jsonb,
    read_at   timestamptz NOT NULL DEFAULT now()
);

-- `privileges.md`: a migration that creates a table grants it in the same file, because
-- `040_grants.sql` said ON ALL TABLES and can never run again. The control plane gets the DML
-- every `app` table carries (the gate test enumerates the schema); it reads this for `runs.get`
-- and may delete a run with its rows, as it may for `ops.run_entity`. The worker records and
-- reads, and never rewrites -- see above.
GRANT SELECT, INSERT, UPDATE, DELETE ON app.run_scope TO undercroft_app;
GRANT SELECT, INSERT ON app.run_scope TO undercroft_worker;

-- The journal filtered to one account (`runs.list` with a source) reads one (tenant, source) in
-- start order. `run_tenant_started` (090) serves the unfiltered ledger and would make this a
-- filter over every run the tenant has; a tenant with a busy extract verb has thousands.
CREATE INDEX IF NOT EXISTS run_tenant_source_started
    ON ops.run (tenant_id, source, started_at DESC, id DESC);

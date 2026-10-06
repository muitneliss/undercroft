-- app.bi_export: an export a person asked for, waiting to be downloaded. ADR 0111.
--
-- WHY A ROW. An export is handed out as a link, because a model-context host can show a person a
-- link and cannot save a file for them. `bi.exports.create` decides everything a procedure
-- decides -- who may, which SQL -- and the download, a plain GET, finds that decision here by id.
-- The row is not a credential: the download re-admits the person's own cookie or bearer, through
-- the same router, and answers only the person who asked (`user_id`).
--
-- WHAT IS STORED. The SQL as it was compiled and bound when it was asked for, so the file is what
-- was asked for even if the question is edited before the download. `kind`, the source it came
-- from, because a viewer may export a saved question and only a member anything else, and that
-- is asked again at the download. The file's name. Never a row of the answer: the rows go from
-- the worker to the person and are kept nowhere.
--
-- SHORT-LIVED. Fifteen minutes from the database's own clock, set by the INSERT; the CHECK keeps
-- any writer to an hour. An expired row answers nobody, and the next export asked for deletes it.

CREATE TABLE IF NOT EXISTS app.bi_export (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  text        NOT NULL REFERENCES ops.tenant(id) ON DELETE CASCADE,
    user_id    uuid        NOT NULL REFERENCES app.app_user(id) ON DELETE CASCADE,
    kind       text        NOT NULL CHECK (kind IN ('question', 'definition', 'model')),
    sql        text        NOT NULL CHECK (length(sql) > 0),
    file_name  text        NOT NULL CHECK (length(file_name) BETWEEN 1 AND 200),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    CONSTRAINT bi_export_expiry_bounded CHECK (
        expires_at > created_at AND expires_at <= created_at + interval '1 hour'
    )
);

-- The sweep on every insert deletes by expiry; the download reads by primary key.
CREATE INDEX IF NOT EXISTS bi_export_expiry_idx ON app.bi_export (expires_at);

-- -- grants -------------------------------------------------------------------------------
-- In this file, for the reason `privileges.md` gives: 040's `ON ALL TABLES IN SCHEMA app` was
-- expanded against the tables that existed when it ran, so a table added later has NO grants.
-- The control plane's whole DML, as every table in `app` grants it (`privileges.test.ts`), though
-- it only ever inserts, reads and sweeps a row here.
GRANT SELECT, INSERT, UPDATE, DELETE ON app.bi_export TO undercroft_app;

-- Nothing for `undercroft_worker`: the control plane hands the worker the SQL to run, and the
-- worker never reads this table. Nothing for any dbt or BI role: they have no USAGE on `app`.

-- No ALTER DEFAULT PRIVILEGES: none is written by hand anywhere (080_tenant_isolation.sql).

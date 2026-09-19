-- Per-tenant dbt models, stored in Postgres and authored in the browser. See ADR 0018.
--
-- A model is one SQL file and the tests its author chose for its columns. The worker
-- writes every model of a tenant to a temporary project directory right before `dbt build`
-- and removes it after; nothing on disk outlives the build, and this table is the only
-- copy. Saving here executes nothing -- Build is a separate verb -- so a half-written model
-- cannot take a customer's tables down by being saved.
--
-- WHY `app` AND NOT `ops`. The SQL is the customer's, and a customer's SQL may quote a
-- literal -- a name, an address, an amount -- as a filter. `app` is the one schema the BI
-- role has no USAGE on, which makes it the only correct home for text a person wrote.
--
-- `name` is the dbt model name, and dbt uses it as the relation name, so it has to be a
-- plain lowercase identifier. The CHECK is belt and braces behind the contract's regex: a
-- name that reaches this table by any other path is still refused.
--
-- `columns` is what the last successful build found the model's relation to have, written
-- by the WORKER after a build and read by the editor to offer column names for tests. A
-- column-level grant, so the worker can record what it built and cannot rewrite what the
-- customer wrote.

CREATE TABLE IF NOT EXISTS app.model (
    tenant_id  text        NOT NULL REFERENCES ops.tenant(id) ON DELETE CASCADE,
    name       text        NOT NULL CHECK (name ~ '^[a-z][a-z0-9_]*$' AND length(name) <= 63),
    sql        text        NOT NULL,
    -- {"columns": {"deal_id": ["not_null", "unique"]}}; the shape is the contract's
    -- (`ModelTests` in @undercroft/contracts), validated before it reaches here.
    tests      jsonb       NOT NULL DEFAULT '{"columns":{}}'::jsonb,
    columns    jsonb       NOT NULL DEFAULT '[]'::jsonb,
    -- The app_user uuid of whoever last saved. Who wrote the SQL is part of the SQL.
    updated_by text        NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, name)
);

-- The control plane owns the rows (040's ON ALL TABLES grant was a one-shot snapshot; see
-- 060_auth.sql). The worker reads them to materialise a build and writes back one column.
GRANT SELECT, INSERT, UPDATE, DELETE ON app.model TO undercroft_app;
GRANT SELECT ON app.model TO undercroft_worker;
GRANT UPDATE (columns) ON app.model TO undercroft_worker;

-- No ALTER DEFAULT PRIVILEGES: none is written by hand anywhere (080_tenant_isolation.sql).

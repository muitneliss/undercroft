-- Questions and dashboards: what the Reports division saves, per tenant.
--
-- A question is a definition -- a visual one the builder made, or SQL the author wrote --
-- and how it is drawn. A dashboard is a grid of questions and the shared filters bound
-- into them. Both are the customer's, both may quote a literal a person typed (a name in a
-- filter, an address in a WHERE), and so both live in `app`, the one schema the BI role
-- has no USAGE on. The rows a question answers with are never stored: they are read at
-- the moment of asking, as the tenant's read-only login, by the worker.
--
-- The shapes of `definition`, `chart`, `layout` and `filters` are the contract's
-- (`@undercroft/contracts/bi`), validated before a row is written; the schema keeps them
-- as jsonb so a new chart type or filter kind is a contract change and not a migration.

CREATE TABLE IF NOT EXISTS app.bi_question (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  text        NOT NULL REFERENCES ops.tenant(id) ON DELETE CASCADE,
    name       text        NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    definition jsonb       NOT NULL,
    chart      jsonb       NOT NULL DEFAULT '{"type":"table"}'::jsonb,
    -- app_user uuids: who wrote it and who last changed it are part of the question.
    created_by text        NOT NULL DEFAULT '',
    updated_by text        NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bi_question_tenant_idx ON app.bi_question (tenant_id, name);

CREATE TABLE IF NOT EXISTS app.bi_dashboard (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  text        NOT NULL REFERENCES ops.tenant(id) ON DELETE CASCADE,
    name       text        NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    layout     jsonb       NOT NULL DEFAULT '{"tiles":[]}'::jsonb,
    filters    jsonb       NOT NULL DEFAULT '[]'::jsonb,
    created_by text        NOT NULL DEFAULT '',
    updated_by text        NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bi_dashboard_tenant_idx ON app.bi_dashboard (tenant_id, name);

-- The control plane owns both (040's ON ALL TABLES grant was a one-shot snapshot; see
-- 060_auth.sql). The worker never reads a question: the control plane compiles it and
-- hands the worker SQL.
GRANT SELECT, INSERT, UPDATE, DELETE ON app.bi_question, app.bi_dashboard TO undercroft_app;

-- No ALTER DEFAULT PRIVILEGES: none is written by hand anywhere (080_tenant_isolation.sql).

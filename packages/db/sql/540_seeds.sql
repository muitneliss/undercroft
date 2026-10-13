-- Per-tenant reference tables -- dbt seeds -- stored in Postgres beside the models that read
-- them. ADR 0128.
--
-- A seed is a small table a person keeps by hand: accounts mapped to groups, a reviewer's list of
-- people and roles. The worker renders every seed of a tenant into that tenant's throwaway dbt
-- project, as `seeds/<name>.csv` with its declared column types, right before `dbt build`;
-- nothing on disk outlives the build and this table is the only copy -- the arrangement of
-- `app.model` (140) and `app.macro` (410). A model reads one with `{{ ref('name') }}`, and dbt
-- loads it into the tenant's own `analytics_<slug>`, owned by the tenant's dbt login, where the
-- BI role's default SELECT reaches it like any model's table (repeatable/010_provision_tenant).
-- So no grant is added for the loaded table: it is a relation like every other the login makes.
--
-- WHY `app`. A seed's cells are text a person wrote and may name people, like a model's SQL may
-- quote a literal. `app` is the schema neither the BI role nor any dbt role has USAGE on, so the
-- STORED copy is reachable only through the control plane and the worker; what a dashboard
-- reads is the loaded table, which the tenant chose to build.
--
-- `columns` is `[{"name": ..., "type": ...}]` and `rows` is an array of arrays of string or
-- null, one string per declared column. Neither is ever a number: an amount is the text it was
-- written as (`.claude/rules/money.md`). What a cell may be for its column's type, and the
-- bounds, are decided in `packages/contracts/src/seeds.ts`, one place; the CHECKs here
-- are belt and braces on the shape.

CREATE TABLE IF NOT EXISTS app.seed (
    tenant_id   text        NOT NULL REFERENCES ops.tenant(id) ON DELETE CASCADE,
    name        text        NOT NULL CHECK (name ~ '^[a-z][a-z0-9_]*$' AND length(name) <= 63),
    columns     jsonb       NOT NULL CHECK (jsonb_typeof(columns) = 'array'),
    rows        jsonb       NOT NULL CHECK (jsonb_typeof(rows) = 'array'),
    -- The app_user uuid of whoever last saved.
    updated_by  text        NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, name)
);

-- The control plane owns the rows; the worker reads them to render a build and writes nothing.
GRANT SELECT, INSERT, UPDATE, DELETE ON app.seed TO undercroft_app;
GRANT SELECT ON app.seed TO undercroft_worker;

-- No ALTER DEFAULT PRIVILEGES: none is written by hand anywhere (080_tenant_isolation.sql).

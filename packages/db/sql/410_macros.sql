-- Per-tenant dbt macros, stored in Postgres beside the models that call them. ADR 0086.
--
-- A macro is one `{% macro name(args) %} ... {% endmacro %}` definition, written whole by the
-- tenant's admin. The worker renders every macro of a tenant into that tenant's throwaway dbt
-- project, at `macros/tenant/<name>.sql`, right before `dbt build`; nothing on disk outlives the
-- build and this table is the only copy -- the same arrangement as `app.model` (140).
--
-- WHY `app`. A macro is text a person wrote, and it may quote a literal -- a company suffix, a
-- name -- like a model's SQL may. `app` is the schema the BI role has no USAGE on, and no dbt
-- role has USAGE on it either, so a model cannot read another tenant's macros any more than it
-- can read a credential. The worker reads the rows and writes them to the project directory.
--
-- `name` is the macro's own name in the definition, and a Jinja name, so it is a plain
-- lowercase identifier; the CHECK is belt and braces behind the contract. Which names a tenant
-- may NOT take (dbt's own, the platform's, `__` dispatch names) is decided in
-- `packages/db/src/services/macroDefinition.ts`, one place, rather than half-copied here.
--
-- `description` is what an agent reads to choose a macro to reuse before writing an expression
-- again, so it is required.

CREATE TABLE IF NOT EXISTS app.macro (
    tenant_id   text        NOT NULL REFERENCES ops.tenant(id) ON DELETE CASCADE,
    name        text        NOT NULL CHECK (name ~ '^[a-z][a-z0-9_]*$' AND length(name) <= 63),
    description text        NOT NULL CHECK (length(description) BETWEEN 1 AND 500),
    sql         text        NOT NULL,
    -- The app_user uuid of whoever last saved.
    updated_by  text        NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, name)
);

-- The control plane owns the rows; the worker reads them to render a build and writes nothing.
GRANT SELECT, INSERT, UPDATE, DELETE ON app.macro TO undercroft_app;
GRANT SELECT ON app.macro TO undercroft_worker;

-- No ALTER DEFAULT PRIVILEGES: none is written by hand anywhere (080_tenant_isolation.sql).

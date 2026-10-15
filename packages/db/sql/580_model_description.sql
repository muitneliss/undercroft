-- A model may carry its author's description. ADR 0137.
--
-- Optional: NULL is a model nobody described, which is every model saved before this file and
-- any model saved without one since. It is never a flag and nothing reads NULL as incomplete
-- (ADR 0112 removed a feature that did).
--
-- The CHECK is belt and braces behind the contract's `ModelDescription`, as `name`'s is in
-- `140_models.sql`: at most 1000 characters, never empty, and neither brace -- dbt renders a
-- description through Jinja when it parses the project, and one that is not valid Jinja fails
-- the parse of every model of the tenant, not only this one.
--
-- No grant moves: `140_models.sql` grants `app.model` table-wide, to the control plane to write
-- and to the worker to read, which is what the worker needs to write it into `schema.yml`. The
-- worker's one column-scoped UPDATE stays `columns`.

ALTER TABLE app.model ADD COLUMN IF NOT EXISTS description text NULL
    CONSTRAINT model_description_shape
    CHECK (description IS NULL OR (length(description) BETWEEN 1 AND 1000 AND description !~ '[{}]'));

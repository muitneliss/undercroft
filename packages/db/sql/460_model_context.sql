-- A model's business context: what a row is, its key, what each column means, the rules it
-- applies. One per model, approved by a person. ADR 0104.
--
-- WHY `app`. The context is text the customer wrote about their own business -- a definition
-- may name a customer, a rule may quote a threshold -- exactly like a model's SQL (140) or a
-- macro (410). `app` is the schema neither the BI role nor any dbt role has USAGE on, so a
-- dashboard cannot read it and a model cannot select it.
--
-- WHY ON DELETE CASCADE. A context describes ONE model's definition. A model deleted and later
-- created again under the same name is a different model, written by someone who may never
-- have seen the first; inheriting the old context would show a stranger's description as if
-- it were reviewed. So the row goes with the model, and the new one starts `incomplete`.
--
-- WHAT IS NEVER STORED: the state. `incomplete`, `needs_review` and `current` are computed when
-- the context is read, by comparing `reviewed` -- the fingerprint of the definition the context
-- was approved against: the model's own SQL, tests and built columns, and those of each model
-- it read directly -- with what `app.model` holds now. A stored state would be stale the moment
-- a scheduled build changed a column, and the worker, which records columns, is deliberately
-- given nothing here.
--
-- `body` is the contract's `ModelContext`, validated before it reaches this table. Saving the
-- row IS the approval, so `reviewed_by` / `reviewed_at` are who approved it and when.

CREATE TABLE IF NOT EXISTS app.model_context (
    tenant_id   text        NOT NULL,
    model_name  text        NOT NULL,
    body        jsonb       NOT NULL,
    reviewed    jsonb       NOT NULL,
    -- The app_user uuid of whoever approved it.
    reviewed_by text        NOT NULL,
    reviewed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, model_name),
    FOREIGN KEY (tenant_id, model_name) REFERENCES app.model (tenant_id, name) ON DELETE CASCADE
);

-- The control plane alone reads and writes it. No grant to the worker (a build changes the
-- definition, never the description), and BI has no USAGE on `app` at all.
GRANT SELECT, INSERT, UPDATE, DELETE ON app.model_context TO undercroft_app;

-- No ALTER DEFAULT PRIVILEGES: none is written by hand anywhere (080_tenant_isolation.sql).

-- Row and column rules on a model grant: "the head of Sales sees only Sales's rows", "staff do
-- not see the salary column". ADR 0143, the last of the four changes ADR 0139 planned.
--
-- ## What a rule is
--
-- A rule NARROWS the grant it belongs to. A grant on one model (`model:<name>`, `read`) may carry
--
--   row_rule        one or more conditions, ANDed: `[{"column": "dept", "op": "in",
--                   "values": ["Sales", "Support"]}]`. A row the reader sees meets all of them.
--   hidden_columns  the columns the reader may not read: `{salary, bonus}`.
--
-- and a grant with neither reaches the whole table, as before. `model:*` cannot carry a rule --
-- a rule names a model's columns, and "every model" has none -- and neither can a permission, a
-- raw stream or a report: the CHECK below says so. Raw rows stay out of scope (ADR 0143).
--
-- What a reader ends up with is the UNION over every grant that reaches them on the model -- a
-- grant without a row rule is every row, `model:*` is the whole table, and the visible columns
-- are the union of each grant's -- and that is computed by the control plane (`rbac.ts`) and
-- enforced by the scope login's grants and row-level policies (`repeatable/010_provision_tenant
-- .sql`). This file only stores what one grant says.
--
-- ## The shape, checked here as well as at the door
--
-- `app.row_rule_shape` and `app.column_list_shape` are the database's copy of the bounds
-- `@undercroft/contracts/access` validates with (`MAX_RULE_CONDITIONS` and the rest), for the
-- reason ADR 0141 gives for the role CHECKs: every writer reaches these columns, not only the
-- service that remembers to validate. A column is an identifier (`^[A-Za-z_][A-Za-z0-9_]{0,62}$`);
-- a value is a string of at most 200 characters with no control character, compared with the
-- column's own type when the rule is applied; `eq` carries exactly one value and `in` one to a
-- hundred. Neither column holds an empty list: no rule is NULL, so there is one way to say it.
--
-- Written in PL/pgSQL rather than as one boolean expression, because SQL promises no order of
-- evaluation: `jsonb_array_length` on something that is not an array raises, and an OR in front of
-- it would not reliably stop it.
--
-- ## Saving the same grant again replaces its rules
--
-- `access_grant_once` is unchanged: one grant per subject, object and action. Its rules are what
-- the grant says, like its expiry, so saving it again with other rules REPLACES them
-- (`repos/accessGrants.ts`); two grants to one subject on one model, each with its own rule,
-- would be a union nobody could see in one row.

CREATE FUNCTION app.column_list_shape(p_columns text[]) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $fn$
BEGIN
    IF p_columns IS NULL OR cardinality(p_columns) NOT BETWEEN 1 AND 200 THEN
        RETURN false;
    END IF;
    RETURN NOT EXISTS (
        SELECT 1 FROM unnest(p_columns) AS c(name)
        WHERE c.name IS NULL OR c.name !~ '^[A-Za-z_][A-Za-z0-9_]{0,62}$');
END
$fn$;

CREATE FUNCTION app.row_rule_shape(p_rule jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $fn$
DECLARE
    v_condition jsonb;
    v_value     jsonb;
    v_count     integer;
BEGIN
    IF p_rule IS NULL OR jsonb_typeof(p_rule) <> 'array' THEN
        RETURN false;
    END IF;
    IF jsonb_array_length(p_rule) NOT BETWEEN 1 AND 10 THEN
        RETURN false;
    END IF;
    FOR v_condition IN SELECT value FROM jsonb_array_elements(p_rule) LOOP
        IF jsonb_typeof(v_condition) <> 'object' THEN
            RETURN false;
        END IF;
        IF (SELECT count(*) FROM jsonb_object_keys(v_condition)) <> 3
           OR jsonb_typeof(v_condition -> 'column') IS DISTINCT FROM 'string'
           OR jsonb_typeof(v_condition -> 'op') IS DISTINCT FROM 'string'
           OR jsonb_typeof(v_condition -> 'values') IS DISTINCT FROM 'array' THEN
            RETURN false;
        END IF;
        IF (v_condition ->> 'column') !~ '^[A-Za-z_][A-Za-z0-9_]{0,62}$'
           OR (v_condition ->> 'op') NOT IN ('eq', 'in') THEN
            RETURN false;
        END IF;
        v_count := jsonb_array_length(v_condition -> 'values');
        IF v_count NOT BETWEEN 1 AND 100
           OR ((v_condition ->> 'op') = 'eq' AND v_count <> 1) THEN
            RETURN false;
        END IF;
        FOR v_value IN SELECT value FROM jsonb_array_elements(v_condition -> 'values') LOOP
            IF jsonb_typeof(v_value) <> 'string' OR length(v_value #>> '{}') > 200
               OR (v_value #>> '{}') ~ '[[:cntrl:]]' THEN
                RETURN false;
            END IF;
        END LOOP;
    END LOOP;
    RETURN true;
END
$fn$;

-- The CHECKs below run as whoever writes the row, which is the control plane; nobody else needs
-- them, and PUBLIC's default EXECUTE is taken away as everywhere else.
REVOKE ALL ON FUNCTION app.column_list_shape(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.row_rule_shape(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.column_list_shape(text[]), app.row_rule_shape(jsonb) TO undercroft_app;

ALTER TABLE app.access_grant
    ADD COLUMN row_rule       jsonb,
    ADD COLUMN hidden_columns text[],
    ADD CONSTRAINT access_grant_rules_on_one_model CHECK (
        (row_rule IS NULL AND hidden_columns IS NULL)
        OR (action = 'read' AND object ~ '^model:[a-z][a-z0-9_]{0,62}$')
    ),
    ADD CONSTRAINT access_grant_row_rule_shape
        CHECK (row_rule IS NULL OR app.row_rule_shape(row_rule)),
    ADD CONSTRAINT access_grant_hidden_columns_shape
        CHECK (hidden_columns IS NULL OR app.column_list_shape(hidden_columns));

-- ## What a scope login was made for, rules included
--
-- `limits` is the canonical form of the rules a scope login enforces -- one entry per narrowed
-- model, `{"model", "rows", "hidden"}`, sorted, as `ops.scope_limits` writes it -- and `'[]'` for a
-- scope that narrows no model, which is every scope made before this change. Two readers with the
-- same models and different rules hash to two scopes (`undercroft.scope/2`), so they never share a
-- login; a scope with no rules keeps its `/1` hash, its name and its grants.
ALTER TABLE ops.tenant_scope ADD COLUMN limits jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ## An export keeps the rules its asker read under
--
-- Beside `scope_models` (620): the download runs under the narrower of what the asker read under
-- when they asked and what they read under when they download (`services/biExports.ts`). NULL for
-- an export asked before this change, which was asked with no rules.
ALTER TABLE app.bi_export ADD COLUMN scope_limits jsonb;

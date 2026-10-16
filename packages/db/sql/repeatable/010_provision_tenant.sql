-- ops.provision_tenant: what a customer's two logins are, and what they may read.
--
-- REPEATABLE. This file is re-applied on EVERY migrate run, after every numbered file, and
-- is not recorded in the ledger. It lives here rather than in `080_tenant_isolation.sql`
-- because its body is a POLICY, not a change: it decides what every tenant login may read,
-- and a policy that only reaches databases created after it was written is not one.
--
-- THE DEFECT THIS CLOSES. The grant list below grew twice -- `raw.document_text` in 180
-- (ADR 0024) and the six search functions in 190 (ADR 0026) -- by editing 080 in place. The
-- ledger keys on a file's name and holds no checksum, so in a database where 080 had already
-- run that edit changed nothing at all: the stored function body stayed as it was, and every
-- tenant provisioned from then on was built by the old one. Both files carried a catch-up
-- loop over `ops.tenant_role`, which vaccinated the tenants that existed the day it ran and
-- nothing afterwards. Production had exactly that: two tenants correct, and one created later
-- that could read neither the extracted text nor its own search index -- surfacing as
-- `permission denied for table document_text` in the Lake console, for an admin who held
-- every authority the application had to give. ADR 0036.
--
-- WHAT THIS MEANS FOR THE NEXT GRANT. Add it to the list below and that is the whole change.
-- No catch-up loop, no second copy: the next deploy replaces the function in every database
-- and the tail of this file re-provisions every tenant that already exists.
--
-- Everything else about the design -- SECURITY DEFINER and who owns it, why row-level
-- security is keyed on the login, what this does to ADR 0005's "exactly one ALTER DEFAULT
-- PRIVILEGES" -- is unchanged and is recorded at the top of `080_tenant_isolation.sql`,
-- beside the table and the policies this function's grants are about.

-- Idempotent: running it again for a tenant that already has its roles changes nothing, so
-- the worker can call it before a build as belt and braces for tenants created before this
-- migration existed.
CREATE OR REPLACE FUNCTION ops.provision_tenant(p_tenant_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, ops AS $fn$
DECLARE
    v_slug      text;
    v_dbt       name;
    v_bi        name;
    v_analytics name;
    v_dq        name;
    v_staging   name;
BEGIN
    IF p_tenant_id !~ '^[A-Za-z0-9_-]{1,64}$' THEN
        RAISE EXCEPTION 'undercroft: tenant id % is not a valid reference', p_tenant_id
            USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM ops.tenant WHERE id = p_tenant_id) THEN
        RAISE EXCEPTION 'undercroft: tenant % does not exist', p_tenant_id
            USING ERRCODE = 'no_data_found';
    END IF;

    v_slug := ops.tenant_slug(p_tenant_id);
    -- NAMEDATALEN is 63; `undercroft_dbt_` is 15. Forty leaves the prefix room and keeps
    -- the two role names, the two schema names and the slug from ever being truncated.
    IF v_slug = '' OR length(v_slug) > 40 THEN
        RAISE EXCEPTION 'undercroft: tenant id % makes no usable role name', p_tenant_id
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    v_dbt       := 'undercroft_dbt_' || v_slug;
    v_bi        := 'undercroft_bi_'  || v_slug;
    v_analytics := 'analytics_'      || v_slug;
    v_dq        := 'dq_'             || v_slug;
    v_staging   := 'staging_'        || v_slug;

    -- Two tenants whose ids fold to one slug would share a login. Refused before any role
    -- exists, with an error the control plane can name to the operator.
    IF EXISTS (SELECT 1 FROM ops.tenant_role
               WHERE role_name IN (v_dbt, v_bi) AND tenant_id <> p_tenant_id) THEN
        RAISE EXCEPTION 'undercroft: the role name for % already belongs to another tenant', p_tenant_id
            USING ERRCODE = 'unique_violation';
    END IF;

    INSERT INTO ops.tenant_role (tenant_id, kind, role_name, slug)
    VALUES (p_tenant_id, 'dbt', v_dbt, v_slug), (p_tenant_id, 'bi', v_bi, v_slug)
    ON CONFLICT (tenant_id, kind) DO NOTHING;

    -- No password: a role nobody has rotated cannot log in. NOINHERIT so a membership
    -- granted by mistake later confers nothing by itself.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_dbt) THEN
        EXECUTE format('CREATE ROLE %I LOGIN NOINHERIT CONNECTION LIMIT 10', v_dbt);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_bi) THEN
        EXECUTE format('CREATE ROLE %I LOGIN NOINHERIT CONNECTION LIMIT 10', v_bi);
    END IF;

    -- A TENANT LOGIN'S LIMIT IS A POLICY, stated here for tenants created before it changed.
    -- Tenant logins reach Postgres through PgBouncer (ADR 0088), which holds at most eight
    -- server connections per login (`MAX_USER_CONNECTIONS` in the compose files) and QUEUES the
    -- rest -- a build takes about five of them (`THREADS` in `dbtProject.ts`, plus dbt's own).
    -- This limit sits two above the pooler's on purpose: a backend still exiting counts toward
    -- it, and an equal limit would turn the pooler's quick reconnect into "too many connections"
    -- and a login-retry stall instead of a wait. Raise the three together.
    -- ALTERed only when it differs: `ALTER ROLE` rewrites the role's row, which the worker's
    -- password rotation also writes, and two writers of one row fail with "tuple concurrently
    -- updated" (ADR 0087).
    IF (SELECT rolconnlimit FROM pg_roles WHERE rolname = v_dbt) <> 10 THEN
        EXECUTE format('ALTER ROLE %I CONNECTION LIMIT 10', v_dbt);
    END IF;
    IF (SELECT rolconnlimit FROM pg_roles WHERE rolname = v_bi) <> 10 THEN
        EXECUTE format('ALTER ROLE %I CONNECTION LIMIT 10', v_bi);
    END IF;

    -- dbt owns the three schemas it writes, and may create in nothing else. A build writes
    -- into staging; only what passed its tests is moved into analytics (ADR 0131). Created here
    -- rather than in a numbered file so a tenant provisioned before staging existed gets it at
    -- the next deploy, and the first build after that promotes as normal.
    EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I AUTHORIZATION %I', v_analytics, v_dbt);
    EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I AUTHORIZATION %I', v_dq, v_dbt);
    EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I AUTHORIZATION %I', v_staging, v_dbt);

    -- dbt reads raw through the PARENT tables only. A partition is not granted, so
    -- `SELECT ... FROM raw.records_default` is a permission error and the row-level policy
    -- on the parent cannot be side-stepped by naming the partition.
    --
    -- THIS LIST IS THE ONE PLACE A TENANT'S READ ACCESS IS STATED. Adding to it is the
    -- whole of adding a grant; see this file's header for why it used to take three edits
    -- and still miss a database.
    EXECUTE format('GRANT USAGE ON SCHEMA raw TO %I', v_dbt);
    EXECUTE format(
        'GRANT SELECT ON raw.records, raw.documents, raw.document_text, raw.document_kind,
             raw.document_kind_definition, raw.document_kinds, raw.document_sheets,
             raw.document_rows, raw.document_rows_refusal TO %I',
        v_dbt);
    EXECUTE format('GRANT EXECUTE ON FUNCTION raw.tenant_of(name) TO %I', v_dbt);
    EXECUTE format(
        'GRANT EXECUTE ON FUNCTION raw.search_cap(), raw.fold(text), raw.search_tsv(text),
             raw.record_tsv(jsonb), raw.search_query(text),
             raw.search_excerpt(text, text, integer) TO %I',
        v_dbt);
    -- The search's candidate lookups (530, ADR 0123): SECURITY DEFINER, and they answer only
    -- with keys of the calling login's own rows, so they widen nothing the policy allows.
    EXECUTE format(
        'GRANT EXECUTE ON FUNCTION raw.search_record_candidates(name, text, integer, text[], text[]),
             raw.search_document_candidates(name, text, integer, text[], text[]) TO %I',
        v_dbt);
    -- A promotion grants each scope login the staged tables it reaches before moving them, so a
    -- table is never published ungranted to a reader who should see it (ADR 0142). Like the two
    -- above it answers only for the calling login's own customer.
    EXECUTE format('GRANT EXECUTE ON FUNCTION raw.grant_staged_to_scopes(name, text[]) TO %I', v_dbt);

    -- bi reads the tenant's analytics: what is there now, and what dbt creates later.
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', v_analytics, v_bi);
    EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO %I', v_analytics, v_bi);
    EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT ON TABLES TO %I',
        v_dbt, v_analytics, v_bi);

    -- What dbt creates in staging carries BI's SELECT too, so that a relation promoted into
    -- analytics with `ALTER ... SET SCHEMA` -- which keeps a relation's own ACL and applies no
    -- default of the schema it arrives in -- is readable there at once. In staging itself it
    -- grants nothing: BI has no USAGE on the schema (refused below), and without USAGE a
    -- relation's own grant cannot be reached. The grant is issued here, beside the rest of
    -- BI's, rather than by the promotion as each relation lands: a GRANT written at runtime is
    -- a second place a tenant's reach is stated (ADR 0036, ADR 0131).
    EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT ON TABLES TO %I',
        v_dbt, v_staging, v_bi);

    -- Explicit refusals, so a later broad grant is a visible contradiction.
    EXECUTE format('REVOKE ALL ON SCHEMA app, ops FROM %I, %I', v_dbt, v_bi);
    EXECUTE format('REVOKE ALL ON SCHEMA %I FROM %I', v_dq, v_bi);
    -- Staging holds builds no test has passed yet; a dashboard reads none of it (ADR 0131).
    EXECUTE format('REVOKE ALL ON SCHEMA %I FROM %I', v_staging, v_bi);

    -- Belt and braces for the read-only login. The query runner sets both per statement;
    -- these hold for any other client that logs in as the role.
    EXECUTE format('ALTER ROLE %I SET statement_timeout = %L', v_bi, '15s');
    EXECUTE format('ALTER ROLE %I SET default_transaction_read_only = on', v_bi);

    -- The customer's scope logins (ADR 0142): the ones nobody uses any more dropped, and every
    -- other one's grants -- and, since ADR 0143, its column grants and row policies -- restated
    -- by the body below as it stands today, for the reason this file exists: a scope login made
    -- by an older body gets what the current one grants.
    PERFORM ops.drop_stale_scopes(p_tenant_id);
    PERFORM ops.apply_scopes(p_tenant_id);
END
$fn$;

REVOKE ALL ON FUNCTION ops.provision_tenant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.provision_tenant(text) TO undercroft_app, undercroft_worker;

-- -- scope logins (ADR 0142, ADR 0143) ------------------------------------------------
-- A reader who reaches only some of a customer's models -- a role or a person given
-- `model:<name>` grants rather than `model:*` -- or only some of one model's rows or columns,
-- reads as a SCOPE LOGIN: `undercroft_bi_<slug>__<hash7>`, with USAGE on the customer's
-- analytics schema, SELECT on exactly the tables of the models in its scope -- on the columns it
-- may see of each -- and a row-level policy on each table whose rows it may see only some of.
-- Everything below is what such a login may read, and so it lives in this file, the one place a
-- tenant's reach is stated (ADR 0036): `620_scope_logins.sql` holds only the table that records
-- them and the functions that admit them.
--
-- WHY A LOGIN. A stranger's SQL can call `set_config` inside a SELECT and `RESET ROLE` out of a
-- `SET ROLE`; what it cannot change is which login it is (`privileges.md`). So a row policy here
-- names the logins it applies TO, and keys on nothing a session can set. A view per scope was
-- rejected because a view over a published table holds back its next publication (ADR 0131's
-- `settle`), and rewriting the reader's query because a raw-SQL question is the reader's own
-- text. ADR 0142 and ADR 0143 record the rest.
--
-- WHAT IT GETS, AND WHAT IT NEVER GETS.
--   - SELECT on a relation that HOLDS its rows: a table, a partitioned table, a materialised
--     view. Never a view: a view runs with its owner's rights, so granting one would let it read
--     whatever the dbt login can, and a scoped reader asking for a view-materialised model is
--     refused by Postgres, in Postgres's words, rather than answered past their reach.
--   - With hidden columns, SELECT on the OTHER columns only, by name (ADR 0143). Postgres then
--     refuses a hidden column -- named, or through `SELECT *` -- rather than blanking it, and
--     `information_schema` leaves it out. Which columns are visible is decided from the table as
--     it stands when the grant is written, minus the hidden list: a column a later build adds is
--     visible until somebody hides it.
--   - With a row rule, a row-level policy TO that login alone (`ops.apply_row_policies`). A
--     materialised view cannot carry one, so a scope with a row rule on one is granted nothing on
--     it at all.
--   - Grants by name, here and at each promotion -- never `ALTER DEFAULT PRIVILEGES`, which
--     would hand every scope the next table dbt makes.
--   - Nothing in `raw`, `app`, `ops`, `dq_<slug>` or `staging_<slug>`, refused explicitly so a
--     later broad grant is a visible contradiction. `raw.tenant_of` answers only for a login in
--     `ops.tenant_role`, so a scope login matches no tenant's rows in `raw` even with USAGE.
--
-- HOW IT STAYS RIGHT. A scope's models and rules are fixed by its hash, so its grants are only
-- ever ADDED: a table that appears later is granted -- and its policies written -- when it is
-- published (`raw.grant_staged_to_scopes`, inside the promotion's transaction) and restated here
-- on every provisioning; a reader whose reach or rules change moves to another login rather than
-- having this one narrowed. A table's policies are rewritten only when what they should say
-- differs from what they say, because writing one locks the table against every reader.
-- `ops.lock_scopes` serialises the three writers -- a new scope's first grants, a promotion's,
-- and the sweep of stale ones -- per customer, so none of them reads a catalogue another is half
-- way through changing.

-- One customer's scope logins, held for the rest of the transaction. An advisory lock rather
-- than a row lock: a scope being created has no row to lock yet. Every caller takes it before it
-- touches a relation, so no two of them can wait on each other.
CREATE OR REPLACE FUNCTION ops.lock_scopes(p_tenant_id text) RETURNS void
LANGUAGE sql VOLATILE SET search_path = pg_catalog AS $fn$
    SELECT pg_advisory_xact_lock(hashtext('undercroft.scope_logins'), hashtext(p_tenant_id))
$fn$;
REVOKE ALL ON FUNCTION ops.lock_scopes(text) FROM PUBLIC;

-- PR 3's body, which granted a scope its tables from a model list it was handed. The scope's row
-- now carries its rules too, so `ops.apply_scope` reads both from there.
DROP FUNCTION IF EXISTS ops.apply_scope(text, name, text[]);

-- The canonical form of a scope's rules (ADR 0143): what `ops.tenant_scope.limits` holds and what
-- the scope's hash is taken over. The control plane sends, for each model it narrows, the union of
-- the reader's grants on it:
--
--   {"model": "fct_sales", "rows": [<rule>, …] | null, "hidden": ["salary", …]}
--
-- where a rule is one grant's conditions (`app.row_rule_shape`), a row is seen when it meets ANY
-- rule, `rows` null is every row, and `hidden` is what no grant lets them see. Validated here --
-- the worker is the caller, and a malformed rule must raise rather than be read as no rule -- and
-- written in one order whatever order it came in: `op` dropped, because `eq` is `in` with one
-- value; each condition's values deduplicated and sorted, the conditions of a rule sorted, the
-- rules of a model, the hidden columns and the models likewise, all bytewise (`COLLATE "C"`); an
-- entry that narrows nothing dropped. So one set of rules is one text, and one hash, however the
-- grants were read. `@undercroft/contracts`' `scopeKey` reads the same set the same way, for the
-- worker's lease (ADR 0087).
CREATE OR REPLACE FUNCTION ops.scope_limits(p_models text[], p_limits jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, ops AS $fn$
DECLARE
    v_limit  jsonb;
    v_model  text;
    v_seen   text[] := '{}';
    v_rows   jsonb;
    v_hidden jsonb;
    v_out    jsonb[] := '{}';
BEGIN
    IF p_limits IS NULL THEN
        RETURN '[]'::jsonb;
    END IF;
    IF jsonb_typeof(p_limits) <> 'array' OR jsonb_array_length(p_limits) > 10000 THEN
        RAISE EXCEPTION 'undercroft: a scope''s rules are a list, one entry per model'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;
    FOR v_limit IN SELECT value FROM jsonb_array_elements(p_limits) LOOP
        -- One test to a statement: SQL promises no order of evaluation, and `jsonb_object_keys`
        -- or `jsonb_array_length` on the wrong kind of value raises rather than answering false.
        IF jsonb_typeof(v_limit) <> 'object' THEN
            RAISE EXCEPTION 'undercroft: a scope''s rule names a model, its rows and its hidden columns'
                USING ERRCODE = 'invalid_parameter_value';
        END IF;
        IF (SELECT count(*) FROM jsonb_object_keys(v_limit)) <> 3
           OR jsonb_typeof(v_limit -> 'model') IS DISTINCT FROM 'string'
           OR jsonb_typeof(v_limit -> 'hidden') IS DISTINCT FROM 'array'
           OR jsonb_typeof(v_limit -> 'rows') IS NULL
           OR jsonb_typeof(v_limit -> 'rows') NOT IN ('null', 'array') THEN
            RAISE EXCEPTION 'undercroft: a scope''s rule names a model, its rows and its hidden columns'
                USING ERRCODE = 'invalid_parameter_value';
        END IF;
        v_model := v_limit ->> 'model';
        IF NOT (v_model = ANY (p_models)) OR v_model = ANY (v_seen) THEN
            RAISE EXCEPTION 'undercroft: a scope''s rule names % once, and only a model of the scope', v_model
                USING ERRCODE = 'invalid_parameter_value';
        END IF;
        v_seen := v_seen || v_model;
        IF jsonb_array_length(v_limit -> 'hidden') > 200
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_limit -> 'hidden') h
                      WHERE jsonb_typeof(h) <> 'string'
                         OR (h #>> '{}') !~ '^[A-Za-z_][A-Za-z0-9_]{0,62}$') THEN
            RAISE EXCEPTION 'undercroft: a scope hides columns by their names, and nothing else'
                USING ERRCODE = 'invalid_parameter_value';
        END IF;
        v_rows := v_limit -> 'rows';
        IF jsonb_typeof(v_rows) = 'array' THEN
            IF jsonb_array_length(v_rows) NOT BETWEEN 1 AND 100
               OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) r
                          WHERE NOT app.row_rule_shape(r.value)) THEN
                RAISE EXCEPTION 'undercroft: a scope''s row rule is one to a hundred rules of conditions'
                    USING ERRCODE = 'invalid_parameter_value';
            END IF;
        END IF;

        IF jsonb_typeof(v_rows) = 'array' THEN
            SELECT jsonb_agg(rule ORDER BY rule::text COLLATE "C") INTO v_rows
            FROM (
                SELECT DISTINCT (
                    SELECT jsonb_agg(condition ORDER BY condition::text COLLATE "C")
                    FROM (
                        SELECT DISTINCT jsonb_build_object(
                            'column', c.value ->> 'column',
                            'values', (SELECT jsonb_agg(to_jsonb(v.value) ORDER BY v.value COLLATE "C")
                                       FROM (SELECT DISTINCT value FROM jsonb_array_elements_text(c.value -> 'values')) v)
                        ) AS condition
                        FROM jsonb_array_elements(r.value) c
                    ) conditions
                ) AS rule
                FROM jsonb_array_elements(v_rows) r
            ) rules;
        ELSE
            v_rows := 'null'::jsonb;
        END IF;
        SELECT coalesce(jsonb_agg(to_jsonb(h.name) ORDER BY h.name COLLATE "C"), '[]'::jsonb) INTO v_hidden
        FROM (SELECT DISTINCT value AS name FROM jsonb_array_elements_text(v_limit -> 'hidden')) h;

        IF jsonb_typeof(v_rows) = 'array' OR jsonb_array_length(v_hidden) > 0 THEN
            v_out := v_out || jsonb_build_object('model', v_model, 'rows', v_rows, 'hidden', v_hidden);
        END IF;
    END LOOP;
    RETURN coalesce(
        (SELECT jsonb_agg(o ORDER BY o ->> 'model' COLLATE "C") FROM unnest(v_out) AS o),
        '[]'::jsonb);
END
$fn$;
REVOKE ALL ON FUNCTION ops.scope_limits(text[], jsonb) FROM PUBLIC;

-- The predicate a row rule compiles to on one relation, or NULL when it cannot be compiled there:
-- a rule naming a column the relation does not have, a value that is not of the column's type, a
-- type with no equality. NULL is the caller's to read as "broken", and every caller reads it as
-- seeing NO row -- never as no rule, which would be every row (ADR 0143).
--
-- `rows` is the canonical form above: rules ORed, each rule's conditions ANDed, each condition
-- `<column> = ANY (ARRAY[<value>::<type>, …])`. Written with `%I` and `%L` alone, never from
-- free text. TYPED, against the column's own type (`format_type` without its modifier, so a value
-- longer than a `varchar(10)` is compared whole rather than cut to ten characters and matched):
-- `region_id = '7'` then means the integer 7, `1.50` and `1.5` are one numeric, and a value that
-- is not of the type is refused here rather than at every query. A NULL in the column meets no
-- condition, because `NULL = ANY (…)` is never true.
--
-- WHEN A VALUE IS READ. A literal cast in a policy is converted when the policy is CREATED, by the
-- type's input function, and stored as a constant -- so a reader's own `SET TimeZone` or
-- `SET DateStyle` cannot change which rows a rule matches. The settings it is read under are this
-- function's and `ops.apply_relation`'s own, pinned below, never a session's.
--
-- Whether it compiles is asked by planning it against the relation (`LIMIT 0`, as the definer):
-- that is the parser and the planner refusing exactly what CREATE POLICY would, and reading no row.
CREATE OR REPLACE FUNCTION ops.row_predicate(p_relation oid, p_rows jsonb) RETURNS text
LANGUAGE plpgsql VOLATILE
SET search_path = pg_catalog, ops SET TimeZone = 'UTC' SET DateStyle = 'ISO, YMD'
SET IntervalStyle = 'postgres' SET lc_monetary = 'C' AS $fn$
DECLARE
    v_rule  jsonb;
    v_cond  jsonb;
    v_type  text;
    v_terms text[] := '{}';
    v_conds text[];
    v_pred  text;
BEGIN
    IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) = 0 THEN
        RETURN NULL;
    END IF;
    FOR v_rule IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
        v_conds := '{}';
        FOR v_cond IN SELECT value FROM jsonb_array_elements(v_rule) LOOP
            v_type := NULL;
            SELECT format_type(a.atttypid, NULL) INTO v_type
            FROM pg_attribute a
            WHERE a.attrelid = p_relation AND a.attname = v_cond ->> 'column'
              AND a.attnum > 0 AND NOT a.attisdropped;
            IF v_type IS NULL THEN
                RETURN NULL;
            END IF;
            v_conds := v_conds || format('%I = ANY (ARRAY[%s])', v_cond ->> 'column',
                (SELECT string_agg(format('%L::%s', e.value, v_type), ', ' ORDER BY e.ordinality)
                 FROM jsonb_array_elements_text(v_cond -> 'values') WITH ORDINALITY AS e(value, ordinality)));
        END LOOP;
        IF cardinality(v_conds) = 0 THEN
            RETURN NULL;
        END IF;
        v_terms := v_terms || ('(' || array_to_string(v_conds, ' AND ') || ')');
    END LOOP;
    v_pred := array_to_string(v_terms, ' OR ');
    BEGIN
        EXECUTE format('SELECT 1 FROM %s WHERE %s LIMIT 0', p_relation::regclass, v_pred);
    EXCEPTION WHEN OTHERS THEN
        RETURN NULL;
    END;
    RETURN v_pred;
END
$fn$;
REVOKE ALL ON FUNCTION ops.row_predicate(oid, jsonb) FROM PUBLIC;

-- Make one relation's row policies say what they should, and touch nothing when they already do.
--
--   `undercroft_open`  TO the customer's BI login and every scope login with no row rule on the
--                      relation, USING (true): they see every row, as before.
--   `<scope login>`    one per scope with a row rule, TO that login alone, USING its predicate --
--                      or USING (false) when the predicate does not compile (`ops.row_predicate`):
--                      a broken rule shows that login no row, and everyone else is unaffected.
--
-- Permissive and FOR SELECT, so a login's rows are the OR of the policies naming it -- only ever
-- its own. Row security is ENABLED, not FORCED: the table's owner is the customer's dbt login,
-- which builds, tests and previews it and must read every row, and an owner bypasses unforced
-- policies. Enabled only on a relation some scope has a row rule on; when none has any more, the
-- policies here go, and row security with them unless another policy is left on the relation.
--
-- WHY A FINGERPRINT. Creating or dropping a policy takes the relation's ACCESS EXCLUSIVE lock, and
-- this runs on every provisioning -- before every build and on every deploy. So each policy
-- carries, as its comment, a fingerprint of the roles and the predicate it was written with, and
-- one is rewritten only when that differs.
CREATE OR REPLACE FUNCTION ops.apply_row_policies(p_relation oid, p_open name[], p_ruled jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ops SET TimeZone = 'UTC' SET DateStyle = 'ISO, YMD'
SET IntervalStyle = 'postgres' SET lc_monetary = 'C' AS $fn$
DECLARE
    v_target  text := p_relation::regclass::text;
    v_desired jsonb := '[]';
    v_policy  record;
    v_want    jsonb;
    v_ruled   jsonb;
BEGIN
    IF jsonb_array_length(p_ruled) = 0 THEN
        IF EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = p_relation
                   AND (p.polname = 'undercroft_open' OR p.polname LIKE 'undercroft\_bi\_%')) THEN
            FOR v_policy IN
                SELECT p.polname FROM pg_policy p WHERE p.polrelid = p_relation
                  AND (p.polname = 'undercroft_open' OR p.polname LIKE 'undercroft\_bi\_%')
            LOOP
                EXECUTE format('DROP POLICY %I ON %s', v_policy.polname, v_target);
            END LOOP;
            IF NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = p_relation) THEN
                EXECUTE format('ALTER TABLE %s DISABLE ROW LEVEL SECURITY', v_target);
            END IF;
        END IF;
        RETURN;
    END IF;

    v_desired := v_desired || jsonb_build_object(
        'name', 'undercroft_open',
        'roles', (SELECT jsonb_agg(r ORDER BY r COLLATE "C") FROM (SELECT DISTINCT unnest(p_open)::text AS r) d),
        'qual', 'true');
    FOR v_ruled IN SELECT value FROM jsonb_array_elements(p_ruled) LOOP
        v_desired := v_desired || jsonb_build_object(
            'name', v_ruled ->> 'role', 'roles', jsonb_build_array(v_ruled ->> 'role'),
            'qual', v_ruled ->> 'pred');
    END LOOP;

    -- What stands and should not: a policy of ours no longer wanted, or written otherwise.
    FOR v_policy IN
        SELECT p.polname, obj_description(p.oid, 'pg_policy') AS fingerprint
        FROM pg_policy p WHERE p.polrelid = p_relation
          AND (p.polname = 'undercroft_open' OR p.polname LIKE 'undercroft\_bi\_%')
    LOOP
        SELECT d.value INTO v_want FROM jsonb_array_elements(v_desired) d WHERE d.value ->> 'name' = v_policy.polname;
        IF v_want IS NULL
           OR v_policy.fingerprint IS DISTINCT FROM 'undercroft:' || md5((v_want -> 'roles')::text || '|' || (v_want ->> 'qual')) THEN
            EXECUTE format('DROP POLICY %I ON %s', v_policy.polname, v_target);
        END IF;
    END LOOP;

    FOR v_want IN SELECT value FROM jsonb_array_elements(v_desired) LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = p_relation AND p.polname = v_want ->> 'name') THEN
            EXECUTE format('CREATE POLICY %I ON %s AS PERMISSIVE FOR SELECT TO %s USING (%s)',
                v_want ->> 'name', v_target,
                (SELECT string_agg(quote_ident(r), ', ' ORDER BY ordinality)
                 FROM jsonb_array_elements_text(v_want -> 'roles') WITH ORDINALITY AS e(r, ordinality)),
                v_want ->> 'qual');
            EXECUTE format('COMMENT ON POLICY %I ON %s IS %L', v_want ->> 'name', v_target,
                'undercroft:' || md5((v_want -> 'roles')::text || '|' || (v_want ->> 'qual')));
        END IF;
    END LOOP;

    IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = p_relation) THEN
        EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', v_target);
    END IF;
END
$fn$;
REVOKE ALL ON FUNCTION ops.apply_row_policies(oid, name[], jsonb) FROM PUBLIC;

-- What every scope login of the customer that reaches one relation may read of it, granted: SELECT
-- on the relation, or on its visible columns; and the relation's row policies. One relation at a
-- time, for every scope at once, because a relation's policies are one decision about all of them.
-- Analytics or staging alike: a promotion asks it about the staged relation before moving it
-- (`raw.grant_staged_to_scopes`). Idempotent. Called only from the SECURITY DEFINER functions
-- here, under `ops.lock_scopes`.
CREATE OR REPLACE FUNCTION ops.apply_relation(p_tenant_id text, p_relation oid) RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ops SET TimeZone = 'UTC' SET DateStyle = 'ISO, YMD'
SET IntervalStyle = 'postgres' SET lc_monetary = 'C' AS $fn$
DECLARE
    v_bi      name;
    v_kind    "char";
    v_name    name;
    v_target  text;
    v_scope   record;
    v_rows    jsonb;
    v_hidden  text[];
    v_visible text;
    v_open    name[];
    v_ruled   jsonb := '[]';
BEGIN
    SELECT role_name INTO v_bi FROM ops.tenant_role WHERE tenant_id = p_tenant_id AND kind = 'bi';
    SELECT c.relkind, c.relname INTO v_kind, v_name FROM pg_class c WHERE c.oid = p_relation;
    IF v_bi IS NULL OR v_kind IS NULL OR v_kind NOT IN ('r', 'p', 'm') THEN
        RETURN;
    END IF;
    v_target := p_relation::regclass::text;
    v_open := ARRAY[v_bi];

    FOR v_scope IN
        SELECT s.role_name,
               (SELECT l.value FROM jsonb_array_elements(s.limits) l WHERE l.value ->> 'model' = v_name) AS lim
        FROM ops.tenant_scope s
        WHERE s.tenant_id = p_tenant_id AND v_name = ANY (s.models)
          AND EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = s.role_name)
        ORDER BY s.role_name
    LOOP
        v_rows := v_scope.lim -> 'rows';
        IF jsonb_typeof(v_rows) = 'array' THEN
            -- A materialised view has no row security: a scope that may see only some of its rows
            -- is granted none of it, rather than all.
            CONTINUE WHEN v_kind = 'm';
            v_ruled := v_ruled || jsonb_build_object(
                'role', v_scope.role_name,
                'pred', coalesce(ops.row_predicate(p_relation, v_rows), 'false'));
        ELSE
            v_open := v_open || v_scope.role_name;
        END IF;

        SELECT coalesce(array_agg(h), '{}') INTO v_hidden
        FROM jsonb_array_elements_text(coalesce(v_scope.lim -> 'hidden', '[]'::jsonb)) AS h;
        IF cardinality(v_hidden) = 0 THEN
            EXECUTE format('GRANT SELECT ON %s TO %I', v_target, v_scope.role_name);
        ELSE
            -- The columns standing now, less the hidden ones. A hidden name the relation does not
            -- have hides nothing; a column added by a later build is visible until hidden.
            SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_visible
            FROM pg_attribute a
            WHERE a.attrelid = p_relation AND a.attnum > 0 AND NOT a.attisdropped
              AND NOT (a.attname::text = ANY (v_hidden));
            IF v_visible IS NOT NULL THEN
                EXECUTE format('GRANT SELECT (%s) ON %s TO %I', v_visible, v_target, v_scope.role_name);
            END IF;
        END IF;
    END LOOP;

    IF v_kind <> 'm' THEN
        PERFORM ops.apply_row_policies(p_relation, v_open, v_ruled);
    END IF;
END
$fn$;
REVOKE ALL ON FUNCTION ops.apply_relation(text, oid) FROM PUBLIC;

-- What a scope login is, whatever it reads: USAGE on the analytics schema, the explicit refusals
-- and the read-only settings. Idempotent.
CREATE OR REPLACE FUNCTION ops.apply_scope_login(p_tenant_id text, p_role name) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, ops AS $fn$
DECLARE
    v_slug text;
BEGIN
    SELECT slug INTO v_slug FROM ops.tenant_role WHERE tenant_id = p_tenant_id AND kind = 'bi';
    IF v_slug IS NULL THEN
        RAISE EXCEPTION 'undercroft: tenant % has no roles; provision it first', p_tenant_id
            USING ERRCODE = 'no_data_found';
    END IF;
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', 'analytics_' || v_slug, p_role);
    EXECUTE format('REVOKE ALL ON SCHEMA app, ops, raw FROM %I', p_role);
    EXECUTE format('REVOKE ALL ON SCHEMA %I, %I FROM %I', 'dq_' || v_slug, 'staging_' || v_slug, p_role);
    EXECUTE format('ALTER ROLE %I SET statement_timeout = %L', p_role, '15s');
    EXECUTE format('ALTER ROLE %I SET default_transaction_read_only = on', p_role);
END
$fn$;
REVOKE ALL ON FUNCTION ops.apply_scope_login(text, name) FROM PUBLIC;

-- What one scope login may read, granted: the login itself, and every published relation of its
-- models (`ops.apply_relation`). Called only from the SECURITY DEFINER functions here.
CREATE OR REPLACE FUNCTION ops.apply_scope(p_tenant_id text, p_role name) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, ops AS $fn$
DECLARE
    v_relation oid;
BEGIN
    PERFORM ops.apply_scope_login(p_tenant_id, p_role);
    FOR v_relation IN
        SELECT c.oid FROM ops.tenant_scope s
        JOIN ops.tenant_role t ON t.tenant_id = s.tenant_id AND t.kind = 'bi'
        JOIN pg_namespace n ON n.nspname = 'analytics_' || t.slug
        JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = ANY (s.models)
        WHERE s.tenant_id = p_tenant_id AND s.role_name = p_role AND c.relkind IN ('r', 'p', 'm')
        ORDER BY c.relname
    LOOP
        PERFORM ops.apply_relation(p_tenant_id, v_relation);
    END LOOP;
END
$fn$;
REVOKE ALL ON FUNCTION ops.apply_scope(text, name) FROM PUBLIC;

-- Every scope login of the customer restated, each published relation any of them reaches written
-- once: what `provision_tenant` runs on every deploy and before every build.
CREATE OR REPLACE FUNCTION ops.apply_scopes(p_tenant_id text) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, ops AS $fn$
DECLARE
    v_role     name;
    v_relation oid;
BEGIN
    PERFORM ops.lock_scopes(p_tenant_id);
    FOR v_role IN
        SELECT s.role_name FROM ops.tenant_scope s
        WHERE s.tenant_id = p_tenant_id
          AND EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = s.role_name)
        ORDER BY s.role_name
    LOOP
        PERFORM ops.apply_scope_login(p_tenant_id, v_role);
    END LOOP;
    FOR v_relation IN
        SELECT DISTINCT c.oid FROM ops.tenant_scope s
        JOIN ops.tenant_role t ON t.tenant_id = s.tenant_id AND t.kind = 'bi'
        JOIN pg_namespace n ON n.nspname = 'analytics_' || t.slug
        JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = ANY (s.models)
        WHERE s.tenant_id = p_tenant_id AND c.relkind IN ('r', 'p', 'm')
          AND EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = s.role_name)
    LOOP
        PERFORM ops.apply_relation(p_tenant_id, v_relation);
    END LOOP;
END
$fn$;
REVOKE ALL ON FUNCTION ops.apply_scopes(text) FROM PUBLIC;

-- Whether a scope login's session would open on less than its scope says, for a login that
-- already exists: a published relation of its models it holds no privilege on (but one a row rule
-- withholds from it, a materialised view), one it has a row rule on without its policy, or one
-- under row security whose open policy does not name it. A catalogue read when nothing is missing,
-- which is every time but the once.
CREATE OR REPLACE FUNCTION ops.scope_needs_apply(p_tenant_id text, p_role name) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, ops AS $fn$
    SELECT EXISTS (
        SELECT 1
        FROM ops.tenant_scope s
        JOIN ops.tenant_role t ON t.tenant_id = s.tenant_id AND t.kind = 'bi'
        JOIN pg_namespace n ON n.nspname = 'analytics_' || t.slug
        JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = ANY (s.models)
        CROSS JOIN LATERAL (
            SELECT coalesce(jsonb_typeof((SELECT l.value -> 'rows' FROM jsonb_array_elements(s.limits) l
                                          WHERE l.value ->> 'model' = c.relname)) = 'array', false) AS ruled
        ) r
        WHERE s.tenant_id = p_tenant_id AND s.role_name = p_role AND c.relkind IN ('r', 'p', 'm')
          AND (
            (NOT (c.relkind = 'm' AND r.ruled) AND NOT has_any_column_privilege(p_role, c.oid, 'SELECT'))
            OR (c.relkind <> 'm' AND r.ruled AND NOT EXISTS (
                SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = p_role))
            OR (c.relrowsecurity AND NOT r.ruled AND NOT EXISTS (
                SELECT 1 FROM pg_policy p JOIN pg_roles o ON o.oid = ANY (p.polroles)
                WHERE p.polrelid = c.oid AND p.polname = 'undercroft_open' AND o.rolname = p_role))
          ))
$fn$;
REVOKE ALL ON FUNCTION ops.scope_needs_apply(text, name) FROM PUBLIC;

-- The login a reader of `p_models` under `p_limits` reads as, made and granted the first time
-- anyone needs it. Called by the worker before it leases the login's password
-- (`tenantSession.ts`), with the models and rules the control plane computed from the reader's
-- grants. Idempotent and cheap when the login exists: one row touched, to say the scope is still
-- in use.
--
-- THE CANONICAL FORM is `undercroft.scope/1;models=<names, sorted, comma-separated>` for a scope
-- with no rules -- PR 3's form, so every scope made before rules existed keeps its hash, its name
-- and its grants -- and `undercroft.scope/2;models=<the same>;rules=<ops.scope_limits>` for one
-- with rules, hashed with SHA-256 (ADR 0143). Versioned and named by field, so no scope of one
-- form can hash to a scope of the other; two readers of the same models under different rules are
-- two scopes and two logins. The set is deduplicated and sorted bytewise (`COLLATE "C"`), so a
-- reach is one hash whatever order its grants were read in. A name is `MODEL_NAME`'s grammar and
-- nothing else: a comma, a quote or a `*` is refused before it can make two sets one text, and the
-- rules are validated and written in one order by `ops.scope_limits`.
--
-- THE NAME is `undercroft_bi_<slug>__<first 7 hex of the hash>`: 14 + at most 40 + 2 + 7 = 63,
-- exactly NAMEDATALEN - 1, which is why `provision_tenant` caps the slug at forty. The separator
-- is TWO underscores because no slug can hold two (`ops.tenant_slug` folds every run of other
-- characters into one, and trims them from the ends): with one, a customer whose id were
-- `acme-1a2b3c4d` would have a BI login named exactly as `acme`'s scope login, and whichever was
-- made second would adopt the other's grants. Seven hex characters can collide; the full hash is
-- the row's key, and a name another scope already holds is refused (`unique_violation`) rather
-- than shared.
CREATE OR REPLACE FUNCTION ops.provision_scope(p_tenant_id text, p_models text[], p_limits jsonb)
RETURNS name
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, ops AS $fn$
DECLARE
    v_slug   text;
    v_models text[];
    v_limits jsonb;
    v_text   text;
    v_hash   text;
    v_role   name;
    v_found  name;
BEGIN
    IF p_models IS NULL OR cardinality(p_models) > 10000
       OR EXISTS (SELECT 1 FROM unnest(p_models) AS m(name)
                  WHERE m.name IS NULL OR m.name !~ '^[a-z][a-z0-9_]{0,62}$') THEN
        RAISE EXCEPTION 'undercroft: a scope names models by their names, and nothing else'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;
    SELECT slug INTO v_slug FROM ops.tenant_role WHERE tenant_id = p_tenant_id AND kind = 'bi';
    IF v_slug IS NULL THEN
        RAISE EXCEPTION 'undercroft: tenant % has no roles; provision it first', p_tenant_id
            USING ERRCODE = 'no_data_found';
    END IF;

    SELECT coalesce(array_agg(d.name ORDER BY d.name COLLATE "C"), '{}') INTO v_models
    FROM (SELECT DISTINCT m.name FROM unnest(p_models) AS m(name)) d;
    v_limits := ops.scope_limits(v_models, p_limits);
    v_text := 'models=' || array_to_string(v_models, ',');
    v_text := CASE WHEN v_limits = '[]'::jsonb
                   THEN 'undercroft.scope/1;' || v_text
                   ELSE 'undercroft.scope/2;' || v_text || ';rules=' || v_limits::text END;
    v_hash := encode(sha256(convert_to(v_text, 'UTF8')), 'hex');
    v_role := 'undercroft_bi_' || v_slug || '__' || left(v_hash, 7);

    UPDATE ops.tenant_scope SET last_used_at = now()
    WHERE tenant_id = p_tenant_id AND scope_hash = v_hash
      AND EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = ops.tenant_scope.role_name)
    RETURNING role_name INTO v_found;
    IF v_found IS NOT NULL THEN
        -- Every table of its models standing in analytics should already be granted, its columns
        -- and its policies with it: a promotion writes what it publishes. One that is not -- made
        -- some other way, or restored -- is written now, under the lock, so the reader's session
        -- opens on what their scope says.
        IF ops.scope_needs_apply(p_tenant_id, v_found) THEN
            PERFORM ops.lock_scopes(p_tenant_id);
            PERFORM ops.apply_scope(p_tenant_id, v_found);
        END IF;
        RETURN v_found;
    END IF;

    -- New, or swept away since. Under the customer's lock from here, and asked again: a second
    -- reader of the same set may have made it while this one waited.
    PERFORM ops.lock_scopes(p_tenant_id);
    IF EXISTS (SELECT 1 FROM ops.tenant_role WHERE role_name = v_role)
       OR EXISTS (SELECT 1 FROM ops.tenant_scope
                  WHERE role_name = v_role AND (tenant_id, scope_hash) <> (p_tenant_id, v_hash)) THEN
        RAISE EXCEPTION 'undercroft: the scope login name % is already another scope''s', v_role
            USING ERRCODE = 'unique_violation';
    END IF;
    -- No password: a login nobody has leased cannot log in. NOINHERIT, and the tenant logins'
    -- limit, two above the pooler's per-login cap (ADR 0088).
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
        EXECUTE format('CREATE ROLE %I LOGIN NOINHERIT CONNECTION LIMIT 10', v_role);
    END IF;
    INSERT INTO ops.tenant_scope (tenant_id, scope_hash, role_name, models, limits)
    VALUES (p_tenant_id, v_hash, v_role, v_models, v_limits)
    ON CONFLICT (tenant_id, scope_hash) DO UPDATE SET last_used_at = now();
    PERFORM ops.apply_scope(p_tenant_id, v_role);
    RETURN v_role;
END
$fn$;
REVOKE ALL ON FUNCTION ops.provision_scope(text, text[], jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.provision_scope(text, text[], jsonb) TO undercroft_worker;

-- PR 3's two-argument call, from a worker that predates rules: a scope with none. Kept rather than
-- given a default on the three-argument one, which would make every two-argument call ambiguous.
CREATE OR REPLACE FUNCTION ops.provision_scope(p_tenant_id text, p_models text[]) RETURNS name
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, ops AS $fn$
    SELECT ops.provision_scope(p_tenant_id, p_models, '[]'::jsonb)
$fn$;
REVOKE ALL ON FUNCTION ops.provision_scope(text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.provision_scope(text, text[]) TO undercroft_worker;

-- What of a reader's rules cannot hold against the tables standing now (ADR 0143), for the control
-- plane to tell an administrator and the reader: `scopes.preview` and the access view. One row per
-- model whose row rule is broken, and why:
--
--   column-missing  a rule names a column the table does not have (`columns` names them);
--   value-type      a value is not of its column's type, or the type has no equality;
--   not-a-table     the model is a materialised view, which cannot carry a row policy.
--
-- A broken rule is never read as no rule: the policy writer shows that login no row of the table
-- (`ops.apply_relation`), and this says so. The same `ops.row_predicate` decides both, so the
-- report and the enforcement cannot disagree. A model with nothing published yet has nothing to
-- break and answers nothing. SECURITY DEFINER for the control plane, which has no USAGE on a
-- customer's analytics; it reads the catalogue and plans a `LIMIT 0`, and reads no row.
CREATE OR REPLACE FUNCTION ops.scope_faults(p_tenant_id text, p_models text[], p_limits jsonb)
RETURNS TABLE (model text, fault text, columns text[])
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, ops AS $fn$
DECLARE
    v_slug    text;
    v_limit   jsonb;
    v_rel     oid;
    v_kind    "char";
    v_missing text[];
BEGIN
    SELECT slug INTO v_slug FROM ops.tenant_role WHERE tenant_id = p_tenant_id AND kind = 'bi';
    IF v_slug IS NULL THEN
        RETURN;
    END IF;
    FOR v_limit IN
        SELECT value FROM jsonb_array_elements(ops.scope_limits(
            (SELECT coalesce(array_agg(DISTINCT m), '{}') FROM unnest(p_models) m), p_limits))
    LOOP
        CONTINUE WHEN jsonb_typeof(v_limit -> 'rows') IS DISTINCT FROM 'array';
        v_rel := NULL;
        SELECT c.oid, c.relkind INTO v_rel, v_kind
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'analytics_' || v_slug AND c.relname = v_limit ->> 'model'
          AND c.relkind IN ('r', 'p', 'm');
        CONTINUE WHEN v_rel IS NULL;
        model := v_limit ->> 'model';
        IF v_kind = 'm' THEN
            fault := 'not-a-table';
            columns := '{}';
            RETURN NEXT;
            CONTINUE;
        END IF;
        SELECT coalesce(array_agg(DISTINCT c.name ORDER BY c.name), '{}') INTO v_missing
        FROM jsonb_array_elements(v_limit -> 'rows') r
        CROSS JOIN LATERAL jsonb_array_elements(r.value) cond
        CROSS JOIN LATERAL (SELECT cond.value ->> 'column' AS name) c
        WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a
                          WHERE a.attrelid = v_rel AND a.attname = c.name
                            AND a.attnum > 0 AND NOT a.attisdropped);
        IF cardinality(v_missing) > 0 THEN
            fault := 'column-missing';
            columns := v_missing;
            RETURN NEXT;
        ELSIF ops.row_predicate(v_rel, v_limit -> 'rows') IS NULL THEN
            fault := 'value-type';
            columns := '{}';
            RETURN NEXT;
        END IF;
    END LOOP;
END
$fn$;
REVOKE ALL ON FUNCTION ops.scope_faults(text, text[], jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.scope_faults(text, text[], jsonb) TO undercroft_app;

-- Drop the customer's scope logins nobody has used for `p_unused_for`, and answer how many.
-- Never one a lease may still hold: its password must be unset or expired, and no backend may be
-- open as it -- the worker's leases keep a password valid for as long as any holder runs (ADR
-- 0087), and the pooler closes an idle server connection after fifteen seconds. The row is
-- locked and the test asked under it, so a reader touching the scope in the same instant either
-- keeps it or finds it gone and makes it again (`provision_scope`'s second half). `DROP OWNED`
-- takes the login out of every policy that names it, and drops the one that names it alone.
CREATE OR REPLACE FUNCTION ops.drop_stale_scopes(
    p_tenant_id  text,
    p_unused_for interval DEFAULT interval '7 days'
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, ops AS $fn$
DECLARE
    v_role    name;
    v_dropped integer := 0;
BEGIN
    PERFORM ops.lock_scopes(p_tenant_id);
    FOR v_role IN
        SELECT s.role_name FROM ops.tenant_scope s
        WHERE s.tenant_id = p_tenant_id AND s.last_used_at <= now() - p_unused_for
          AND NOT EXISTS (SELECT 1 FROM pg_roles r
                          WHERE r.rolname = s.role_name
                            AND r.rolvaliduntil IS NOT NULL AND r.rolvaliduntil > now())
          AND NOT EXISTS (SELECT 1 FROM pg_stat_activity a WHERE a.usename = s.role_name)
        ORDER BY s.role_name
        FOR UPDATE OF s SKIP LOCKED
    LOOP
        DELETE FROM ops.tenant_scope WHERE role_name = v_role;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
            -- Its grants first: a role that still holds a privilege cannot be dropped.
            EXECUTE format('DROP OWNED BY %I', v_role);
            EXECUTE format('DROP ROLE %I', v_role);
        END IF;
        v_dropped := v_dropped + 1;
    END LOOP;
    RETURN v_dropped;
END
$fn$;
REVOKE ALL ON FUNCTION ops.drop_stale_scopes(text, interval) FROM PUBLIC;

-- What a promotion calls, as the customer's dbt login, inside its transaction and before it
-- moves anything (`apps/worker/src/services/promote.ts`): write each of the customer's scope
-- logins' access to the STAGED relations it reaches -- SELECT, or SELECT on the visible columns,
-- and the row policies (`ops.apply_relation`). Grants and policies travel with the relation
-- through `ALTER ... SET SCHEMA`, as BI's default grant does (ADR 0131), so a republished table is
-- readable by exactly the scopes that should read it, as much of it as each should read, from the
-- instant it is published -- never ungranted or unlimited in between, and never granted to one
-- that should not. While it is still in staging no scope login can reach it: none has USAGE there.
--
-- WHOSE CUSTOMER is the caller's: `p_login` is the caller's `current_user`, and it must be a
-- customer's dbt login that `session_user` is -- the test `raw.tenant_of` makes -- so a login
-- naming another customer's role is refused. In `raw`, beside `raw.tenant_of`, because a dbt
-- login has USAGE there and none on `ops`.
CREATE OR REPLACE FUNCTION raw.grant_staged_to_scopes(p_login name, p_relations text[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, ops AS $fn$
DECLARE
    v_tenant   text;
    v_slug     text;
    v_relation oid;
BEGIN
    SELECT tenant_id, slug INTO v_tenant, v_slug FROM ops.tenant_role
    WHERE role_name = p_login AND kind = 'dbt' AND pg_has_role(session_user, p_login, 'MEMBER');
    IF v_tenant IS NULL THEN
        RAISE EXCEPTION 'undercroft: % is not a customer''s build login', p_login
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    PERFORM ops.lock_scopes(v_tenant);
    FOR v_relation IN
        SELECT DISTINCT c.oid
        FROM ops.tenant_scope s
        JOIN pg_class c ON c.relname = ANY (s.models)
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE s.tenant_id = v_tenant AND n.nspname = 'staging_' || v_slug
          AND c.relkind IN ('r', 'p', 'm') AND c.relname = ANY (p_relations)
          AND EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = s.role_name)
    LOOP
        PERFORM ops.apply_relation(v_tenant, v_relation);
    END LOOP;
END
$fn$;
REVOKE ALL ON FUNCTION raw.grant_staged_to_scopes(name, text[]) FROM PUBLIC;

-- -- every tenant that already exists ----------------------------------------------
-- The other half of the fix, and the reason the function alone is not enough: replacing the
-- body changes what the NEXT tenant gets, while the ones already provisioned keep whatever
-- the body granted on the day they were created. Re-running it for all of them is what makes
-- a grant added above reach the customers who are already here.
--
-- Cheap and safe to repeat: every statement in the function is idempotent, and a tenant
-- whose grants are already right takes a handful of no-op GRANTs. It is a customer list, not
-- a row count -- if it ever stops being cheap, that is a good problem and a different file.
DO $$
DECLARE t record;
BEGIN
    FOR t IN SELECT id FROM ops.tenant ORDER BY id LOOP
        PERFORM ops.provision_tenant(t.id);
    END LOOP;
END
$$;

-- Per-tenant roles, schemas and row-level security. See docs/adr/0018.
--
-- A customer authors SQL in the browser, and it runs. Under one shared `undercroft_dbt`
-- role that SQL could read every other customer's rows in raw.records, and a filter macro
-- the customer is trusted to keep is not a boundary. So every tenant gets two LOGIN roles of
-- its own -- one that builds, one that reads -- with a schema each, and raw.records and
-- raw.documents refuse to show a login any row but its own tenant's.
--
-- WHY THE FUNCTIONS ARE SECURITY DEFINER, AND WHO OWNS THEM. Creating a role, a schema and
-- a default privilege needs CREATEROLE, CREATE on the database and ownership of the tables
-- being granted; none of the platform roles holds any of that, and none should. So the two
-- operations that need it are functions that do exactly one thing each with an
-- identifier-quoted argument, owned by whichever role applies the migrations (the bootstrap
-- role -- every table here is owned by it already, which is what lets the function grant on
-- them), and executable only by the roles named below. The plaintext of a rotated password
-- is generated INSIDE the second function and returned, so it never appears in a statement
-- a client issued and `log_statement` could record.
--
-- WHY ROW-LEVEL SECURITY IS KEYED ON THE LOGIN. A customer's SQL can `SET` any GUC and
-- `RESET ROLE` out of any `SET ROLE`; what it cannot change without a password is which
-- login it is. `raw.tenant_of(current_user)` answers a tenant only for the login that
-- actually is that tenant's role, so there is nothing in the session for a query to forge.
--
-- WHAT THIS DOES TO ADR 0005'S "EXACTLY ONE ALTER DEFAULT PRIVILEGES". The hazard 0005
-- closed was an UNSCOPED default attaching to whichever role ran a migration. A default
-- issued by this function, scoped `FOR ROLE <the tenant's own dbt role> IN SCHEMA <that
-- role's own schema>`, has none of that hazard. The rule becomes: none is ever written by
-- hand, and `pg_default_acl` holds exactly the legacy row plus one per tenant -- which
-- privileges.test.ts derives from ops.tenant_role and compares in full.

-- -- the mapping ---------------------------------------------------------------
-- The only authority for which login belongs to which customer. Nothing parses a tenant out
-- of a role name for a data decision; the DDL guard below reads the name for a tripwire only.
CREATE TABLE IF NOT EXISTS ops.tenant_role (
    tenant_id  text NOT NULL REFERENCES ops.tenant(id) ON DELETE CASCADE,
    kind       text NOT NULL CHECK (kind IN ('dbt', 'bi')),
    role_name  name NOT NULL UNIQUE,
    slug       text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, kind)
);
-- Not BI: which login belongs to which customer is operational, not analytical.
GRANT SELECT ON ops.tenant_role TO undercroft_app, undercroft_worker;

-- A tenant id folded into something Postgres accepts as an identifier: `CASE-0042` becomes
-- `case_0042`. Two ids that fold to one slug are refused at provisioning, not merged.
CREATE OR REPLACE FUNCTION ops.tenant_slug(p_tenant_id text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
    SELECT trim(both '_' from lower(regexp_replace(p_tenant_id, '[^A-Za-z0-9]+', '_', 'g')))
$$;

-- -- provisioning --------------------------------------------------------------
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
        EXECUTE format('CREATE ROLE %I LOGIN NOINHERIT CONNECTION LIMIT 4', v_dbt);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_bi) THEN
        EXECUTE format('CREATE ROLE %I LOGIN NOINHERIT CONNECTION LIMIT 4', v_bi);
    END IF;

    -- dbt owns the two schemas it writes, and may create in nothing else.
    EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I AUTHORIZATION %I', v_analytics, v_dbt);
    EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I AUTHORIZATION %I', v_dq, v_dbt);

    -- dbt reads raw through the PARENT tables only. A partition is not granted, so
    -- `SELECT ... FROM raw.records_default` is a permission error and the row-level policy
    -- on the parent cannot be side-stepped by naming the partition.
    --
    -- `raw.document_text` joined this list in 180 (ADR 0024), and the search functions in 190
    -- (ADR 0026). Both are edited HERE rather than by replacing this function in those files,
    -- so the provisioning rules stay in one place; each carries a catch-up loop for the
    -- databases where this file has already run, because the migration ledger keys on a file's
    -- name and never re-applies it.
    --
    -- The search functions do not exist yet when this file runs -- 190 creates them. That is
    -- fine and is why the grant is inside `format()`: the body is dynamic SQL, parsed when a
    -- tenant is provisioned, which is always after every migration has been applied.
    EXECUTE format('GRANT USAGE ON SCHEMA raw TO %I', v_dbt);
    EXECUTE format('GRANT SELECT ON raw.records, raw.documents, raw.document_text TO %I', v_dbt);
    EXECUTE format('GRANT EXECUTE ON FUNCTION raw.tenant_of(name) TO %I', v_dbt);
    EXECUTE format(
        'GRANT EXECUTE ON FUNCTION raw.search_cap(), raw.fold(text), raw.search_tsv(text),
             raw.record_tsv(jsonb), raw.search_query(text),
             raw.search_excerpt(text, text, integer) TO %I',
        v_dbt);

    -- bi reads the tenant's analytics: what is there now, and what dbt creates later.
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', v_analytics, v_bi);
    EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO %I', v_analytics, v_bi);
    EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT ON TABLES TO %I',
        v_dbt, v_analytics, v_bi);

    -- Explicit refusals, so a later broad grant is a visible contradiction.
    EXECUTE format('REVOKE ALL ON SCHEMA app, ops FROM %I, %I', v_dbt, v_bi);
    EXECUTE format('REVOKE ALL ON SCHEMA %I FROM %I', v_dq, v_bi);

    -- Belt and braces for the read-only login. The query runner sets both per statement;
    -- these hold for any other client that logs in as the role.
    EXECUTE format('ALTER ROLE %I SET statement_timeout = %L', v_bi, '15s');
    EXECUTE format('ALTER ROLE %I SET default_transaction_read_only = on', v_bi);
END
$fn$;

REVOKE ALL ON FUNCTION ops.provision_tenant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.provision_tenant(text) TO undercroft_app, undercroft_worker;

-- -- rotation -------------------------------------------------------------------
-- The worker mints a password right before it needs one -- a dbt build, a pooled query
-- session -- holds it in memory, and never stores it. A password that is generated here and
-- returned never appears in a client-issued statement, so `log_statement` cannot record it.
CREATE OR REPLACE FUNCTION ops.rotate_tenant_password(
    p_tenant_id text,
    p_kind      text,
    p_valid_for interval DEFAULT interval '1 hour'
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, ops AS $fn$
DECLARE
    v_role     name;
    v_password text;
BEGIN
    SELECT role_name INTO v_role FROM ops.tenant_role
    WHERE tenant_id = p_tenant_id AND kind = p_kind;
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'undercroft: no % role for tenant %', p_kind, p_tenant_id
            USING ERRCODE = 'no_data_found';
    END IF;

    -- 256 bits from pg_strong_random, hex, no separators.
    v_password := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    EXECUTE format('ALTER ROLE %I PASSWORD %L VALID UNTIL %L',
                   v_role, v_password, (clock_timestamp() + p_valid_for)::text);
    RETURN v_password;
END
$fn$;

REVOKE ALL ON FUNCTION ops.rotate_tenant_password(text, text, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.rotate_tenant_password(text, text, interval) TO undercroft_worker;

-- -- row-level security ---------------------------------------------------------
-- Which tenant a login IS. In `raw`, because the tenant roles have USAGE there and none on
-- `ops`. SECURITY DEFINER to read the mapping; the membership test is what keeps a login
-- from learning another tenant's id by naming that tenant's role.
CREATE OR REPLACE FUNCTION raw.tenant_of(p_role name) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, ops AS $$
    SELECT tenant_id FROM ops.tenant_role
    WHERE role_name = p_role AND pg_has_role(session_user, p_role, 'MEMBER')
$$;

REVOKE ALL ON FUNCTION raw.tenant_of(name) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION raw.tenant_of(name) TO undercroft_app, undercroft_worker, undercroft_dbt;

ALTER TABLE raw.records   ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.documents ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    -- The platform roles see everything: the worker writes every tenant's rows and the
    -- control plane previews them for the tenant it has already authorised.
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                   WHERE schemaname = 'raw' AND tablename = 'records' AND policyname = 'platform_all') THEN
        CREATE POLICY platform_all ON raw.records FOR ALL
            TO undercroft_worker, undercroft_app USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                   WHERE schemaname = 'raw' AND tablename = 'documents' AND policyname = 'platform_all') THEN
        CREATE POLICY platform_all ON raw.documents FOR ALL
            TO undercroft_worker, undercroft_app USING (true) WITH CHECK (true);
    END IF;

    -- A tenant's login sees its own tenant's rows and nothing else. The legacy shared
    -- `undercroft_dbt` matches no tenant and therefore sees no row -- nothing runs as it
    -- once every build is per tenant, and a zero it cannot mistake for data is the right
    -- answer for anything that still does.
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                   WHERE schemaname = 'raw' AND tablename = 'records' AND policyname = 'tenant_own') THEN
        CREATE POLICY tenant_own ON raw.records FOR SELECT
            USING (tenant_id = raw.tenant_of(current_user));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                   WHERE schemaname = 'raw' AND tablename = 'documents' AND policyname = 'tenant_own') THEN
        CREATE POLICY tenant_own ON raw.documents FOR SELECT
            USING (tenant_id = raw.tenant_of(current_user));
    END IF;
END
$$;

-- -- the DDL guard, extended ---------------------------------------------------------
-- 050 installed the event trigger; replacing the function's body is enough, and needs no
-- superuser. A tenant's dbt role may create in its own two schemas and nowhere else. The
-- slug is read off the role name here, deliberately: this is a tripwire behind the
-- privilege (dbt_x has CREATE on nothing else), and a tripwire must not depend on a table
-- the invoking role cannot read.
CREATE OR REPLACE FUNCTION ops.guard_ddl() RETURNS event_trigger
LANGUAGE plpgsql AS $guard$
DECLARE
    obj       record;
    v_slug    text;
    v_allowed text[];
BEGIN
    IF current_user = 'undercroft_dbt' THEN
        v_allowed := ARRAY['analytics', 'dq'];
    ELSE
        v_slug := substring(current_user::text from '^undercroft_dbt_(.+)$');
        IF v_slug IS NULL THEN RETURN; END IF;
        v_allowed := ARRAY['analytics_' || v_slug, 'dq_' || v_slug];
    END IF;
    FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands() LOOP
        IF obj.schema_name IS NOT NULL
           AND NOT (obj.schema_name = ANY (v_allowed))
           AND obj.schema_name NOT LIKE 'dbt|_%' ESCAPE '|' THEN
            RAISE EXCEPTION
                'undercroft: % may not create objects outside % (attempted %, in %)',
                current_user, array_to_string(v_allowed, '/'), obj.object_identity, obj.schema_name;
        END IF;
    END LOOP;
END
$guard$;

-- -- tenants that already exist ----------------------------------------------------
DO $$
DECLARE t record;
BEGIN
    FOR t IN SELECT id FROM ops.tenant ORDER BY id LOOP
        PERFORM ops.provision_tenant(t.id);
    END LOOP;
END
$$;

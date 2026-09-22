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
    -- THIS LIST IS THE ONE PLACE A TENANT'S READ ACCESS IS STATED. Adding to it is the
    -- whole of adding a grant; see this file's header for why it used to take three edits
    -- and still miss a database.
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

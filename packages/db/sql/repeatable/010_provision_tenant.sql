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
    -- other one's grants restated by the body below as it stands today, for the reason this
    -- file exists -- a scope login made by an older body gets what the current one grants.
    PERFORM ops.drop_stale_scopes(p_tenant_id);
    PERFORM ops.apply_scope(p_tenant_id, s.role_name, s.models)
    FROM ops.tenant_scope s
    WHERE s.tenant_id = p_tenant_id
      AND EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = s.role_name);
END
$fn$;

REVOKE ALL ON FUNCTION ops.provision_tenant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.provision_tenant(text) TO undercroft_app, undercroft_worker;

-- -- scope logins (ADR 0142) ----------------------------------------------------------
-- A reader who reaches only some of a customer's models -- a role or a person given
-- `model:<name>` grants rather than `model:*` -- reads as a SCOPE LOGIN: `undercroft_bi_<slug>__
-- <hash7>`, with USAGE on the customer's analytics schema and SELECT on exactly the tables of
-- the models in its scope. Everything below is what such a login may read, and so it lives in
-- this file, the one place a tenant's reach is stated (ADR 0036): `620_scope_logins.sql` holds
-- only the table that records them and the functions that admit them.
--
-- WHY A LOGIN. A stranger's SQL can call `set_config` inside a SELECT and `RESET ROLE` out of a
-- `SET ROLE`; what it cannot change is which login it is (`privileges.md`). A view per scope was
-- rejected because a view over a published table holds back its next publication (ADR 0131's
-- `settle`), and rewriting the reader's query because a raw-SQL question is the reader's own
-- text. ADR 0142 records the rest.
--
-- WHAT IT GETS, AND WHAT IT NEVER GETS.
--   - SELECT on a relation that HOLDS its rows: a table, a partitioned table, a materialised
--     view. Never a view: a view runs with its owner's rights, so granting one would let it read
--     whatever the dbt login can, and a scoped reader asking for a view-materialised model is
--     refused by Postgres, in Postgres's words, rather than answered past their reach.
--   - Grants by name, here and at each promotion -- never `ALTER DEFAULT PRIVILEGES`, which
--     would hand every scope the next table dbt makes.
--   - Nothing in `raw`, `app`, `ops`, `dq_<slug>` or `staging_<slug>`, refused explicitly so a
--     later broad grant is a visible contradiction. `raw.tenant_of` answers only for a login in
--     `ops.tenant_role`, so a scope login matches no tenant's rows in `raw` even with USAGE.
--
-- HOW IT STAYS RIGHT. A scope's model set is fixed by its hash, so its grants are only ever
-- ADDED: a table that appears later is granted when it is published (`raw.grant_staged_to_
-- scopes`, inside the promotion's transaction) and restated here on every provisioning; a
-- reader whose reach changes moves to another login rather than having this one narrowed.
-- `ops.lock_scopes` serialises the three writers -- a new scope's first grants, a promotion's,
-- and the sweep of stale ones -- per customer, so none of them reads a catalogue another is
-- half way through changing.

-- One customer's scope logins, held for the rest of the transaction. An advisory lock rather
-- than a row lock: a scope being created has no row to lock yet. Every caller takes it before it
-- touches a relation, so no two of them can wait on each other.
CREATE OR REPLACE FUNCTION ops.lock_scopes(p_tenant_id text) RETURNS void
LANGUAGE sql VOLATILE SET search_path = pg_catalog AS $fn$
    SELECT pg_advisory_xact_lock(hashtext('undercroft.scope_logins'), hashtext(p_tenant_id))
$fn$;
REVOKE ALL ON FUNCTION ops.lock_scopes(text) FROM PUBLIC;

-- What one scope login may read, granted: USAGE on the analytics schema, SELECT on the tables of
-- its models standing there now, the explicit refusals and the read-only settings. Idempotent.
-- Called only from the SECURITY DEFINER functions here, whose owner it runs as.
CREATE OR REPLACE FUNCTION ops.apply_scope(p_tenant_id text, p_role name, p_models text[])
RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, ops AS $fn$
DECLARE
    v_slug      text;
    v_analytics name;
    v_relation  name;
BEGIN
    SELECT slug INTO v_slug FROM ops.tenant_role WHERE tenant_id = p_tenant_id AND kind = 'bi';
    IF v_slug IS NULL THEN
        RAISE EXCEPTION 'undercroft: tenant % has no roles; provision it first', p_tenant_id
            USING ERRCODE = 'no_data_found';
    END IF;
    v_analytics := 'analytics_' || v_slug;

    EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', v_analytics, p_role);
    FOR v_relation IN
        SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = v_analytics AND c.relkind IN ('r', 'p', 'm')
          AND c.relname = ANY (p_models)
        ORDER BY c.relname
    LOOP
        EXECUTE format('GRANT SELECT ON %I.%I TO %I', v_analytics, v_relation, p_role);
    END LOOP;

    EXECUTE format('REVOKE ALL ON SCHEMA app, ops, raw FROM %I', p_role);
    EXECUTE format('REVOKE ALL ON SCHEMA %I, %I FROM %I', 'dq_' || v_slug, 'staging_' || v_slug, p_role);
    EXECUTE format('ALTER ROLE %I SET statement_timeout = %L', p_role, '15s');
    EXECUTE format('ALTER ROLE %I SET default_transaction_read_only = on', p_role);
END
$fn$;
REVOKE ALL ON FUNCTION ops.apply_scope(text, name, text[]) FROM PUBLIC;

-- The login a reader of `p_models` reads as, made and granted the first time anyone needs it.
-- Called by the worker before it leases the login's password (`tenantSession.ts`), with the
-- models the control plane computed from the reader's grants. Idempotent and cheap when the
-- login exists: one row touched, to say the scope is still in use.
--
-- THE CANONICAL FORM is `undercroft.scope/1;models=<names, sorted, comma-separated>`, hashed
-- with SHA-256. It is versioned and named by field so that row and column rules (ADR 0139's
-- fourth change) extend it -- `;rows=…;columns=…` under `/2` -- without any existing scope
-- hashing to a new one's name. The set is deduplicated and sorted bytewise (`COLLATE "C"`), so a
-- reach is one hash whatever order its grants were read in. A name is `MODEL_NAME`'s grammar
-- and nothing else: a comma, a quote or a `*` is refused before it can make two sets one text.
--
-- THE NAME is `undercroft_bi_<slug>__<first 7 hex of the hash>`: 14 + at most 40 + 2 + 7 = 63,
-- exactly NAMEDATALEN - 1, which is why `provision_tenant` caps the slug at forty. The separator
-- is TWO underscores because no slug can hold two (`ops.tenant_slug` folds every run of other
-- characters into one, and trims them from the ends): with one, a customer whose id were
-- `acme-1a2b3c4d` would have a BI login named exactly as `acme`'s scope login, and whichever was
-- made second would adopt the other's grants. Seven hex characters can collide; the full hash is
-- the row's key, and a name another scope already holds is refused (`unique_violation`) rather
-- than shared.
CREATE OR REPLACE FUNCTION ops.provision_scope(p_tenant_id text, p_models text[]) RETURNS name
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, ops AS $fn$
DECLARE
    v_slug   text;
    v_models text[];
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
    v_hash := encode(sha256(convert_to(
        'undercroft.scope/1;models=' || array_to_string(v_models, ','), 'UTF8')), 'hex');
    v_role := 'undercroft_bi_' || v_slug || '__' || left(v_hash, 7);

    UPDATE ops.tenant_scope SET last_used_at = now()
    WHERE tenant_id = p_tenant_id AND scope_hash = v_hash
      AND EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = ops.tenant_scope.role_name)
    RETURNING role_name INTO v_found;
    IF v_found IS NOT NULL THEN
        -- Every table of its models standing in analytics should already be granted: a promotion
        -- grants what it publishes. One that is not -- made some other way, or restored -- is
        -- granted now, under the lock, so the reader's session opens on what their scope says.
        -- A read of the catalogue when nothing is missing, which is every time but that once.
        IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE n.nspname = 'analytics_' || v_slug AND c.relkind IN ('r', 'p', 'm')
                     AND c.relname = ANY (v_models)
                     AND NOT has_table_privilege(v_found, c.oid, 'SELECT')) THEN
            PERFORM ops.lock_scopes(p_tenant_id);
            PERFORM ops.apply_scope(p_tenant_id, v_found, v_models);
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
    INSERT INTO ops.tenant_scope (tenant_id, scope_hash, role_name, models)
    VALUES (p_tenant_id, v_hash, v_role, v_models)
    ON CONFLICT (tenant_id, scope_hash) DO UPDATE SET last_used_at = now();
    PERFORM ops.apply_scope(p_tenant_id, v_role, v_models);
    RETURN v_role;
END
$fn$;
REVOKE ALL ON FUNCTION ops.provision_scope(text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.provision_scope(text, text[]) TO undercroft_worker;

-- Drop the customer's scope logins nobody has used for `p_unused_for`, and answer how many.
-- Never one a lease may still hold: its password must be unset or expired, and no backend may be
-- open as it -- the worker's leases keep a password valid for as long as any holder runs (ADR
-- 0087), and the pooler closes an idle server connection after fifteen seconds. The row is
-- locked and the test asked under it, so a reader touching the scope in the same instant either
-- keeps it or finds it gone and makes it again (`provision_scope`'s second half).
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
-- moves anything (`apps/worker/src/services/promote.ts`): grant each of the customer's scope
-- logins SELECT on the STAGED relations it reaches. The grant travels with the relation through
-- `ALTER ... SET SCHEMA`, as BI's default grant does (ADR 0131), so a republished table is
-- readable by exactly the scopes that should read it from the instant it is published, never
-- ungranted in between and never granted to one that should not. While it is still in staging no
-- scope login can reach it: none has USAGE there.
--
-- WHOSE CUSTOMER is the caller's: `p_login` is the caller's `current_user`, and it must be a
-- customer's dbt login that `session_user` is -- the test `raw.tenant_of` makes -- so a login
-- naming another customer's role is refused. In `raw`, beside `raw.tenant_of`, because a dbt
-- login has USAGE there and none on `ops`.
CREATE OR REPLACE FUNCTION raw.grant_staged_to_scopes(p_login name, p_relations text[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, ops AS $fn$
DECLARE
    v_tenant  text;
    v_slug    text;
    v_staging name;
    v_grant   record;
BEGIN
    SELECT tenant_id, slug INTO v_tenant, v_slug FROM ops.tenant_role
    WHERE role_name = p_login AND kind = 'dbt' AND pg_has_role(session_user, p_login, 'MEMBER');
    IF v_tenant IS NULL THEN
        RAISE EXCEPTION 'undercroft: % is not a customer''s build login', p_login
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    PERFORM ops.lock_scopes(v_tenant);
    v_staging := 'staging_' || v_slug;
    FOR v_grant IN
        SELECT s.role_name, c.relname
        FROM ops.tenant_scope s
        JOIN pg_class c ON c.relname = ANY (s.models)
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE s.tenant_id = v_tenant AND n.nspname = v_staging
          AND c.relkind IN ('r', 'p', 'm') AND c.relname = ANY (p_relations)
          AND EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = s.role_name)
        ORDER BY s.role_name, c.relname
    LOOP
        EXECUTE format('GRANT SELECT ON %I.%I TO %I', v_staging, v_grant.relname, v_grant.role_name);
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

-- Write-audit-publish: a build writes into staging_<slug>, and only what passed is promoted
-- into analytics_<slug>, the schema the BI login reads. ADR 0131.
--
-- Two changes, both of a kind a numbered file is right for:
--
-- 1. `ops.run_step.promoted` records, for each model step, whether that build was promoted into
--    analytics: TRUE published, FALSE built-or-tried and held back (its own tests failed, a
--    parent of this run was held, it did not build, or a view outside the build reads the
--    version it would replace). NULL for a test step and for every step recorded before this
--    file, when a successful build WAS the served version -- `latestTestsPerModel` reads NULL
--    that way, so a model built before the deploy keeps its history.
--
-- 2. The DDL tripwire learns the third schema. A tenant's dbt login now creates in staging, and
--    `ALTER TABLE ... SET SCHEMA` into analytics is reported in analytics, which it already
--    allowed. The schema itself, its owner and what BI may reach of it are the provisioning
--    function's (`repeatable/010_provision_tenant.sql`), never this file's.
--
-- No grant moves: the worker already upserts ops.run_step and the control plane reads it.

ALTER TABLE ops.run_step ADD COLUMN IF NOT EXISTS promoted boolean;

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
        v_allowed := ARRAY['analytics_' || v_slug, 'dq_' || v_slug, 'staging_' || v_slug];
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

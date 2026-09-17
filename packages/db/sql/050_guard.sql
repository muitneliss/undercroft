-- A tripwire: refuse dbt objects created outside analytics/dq.
--
-- This is defence in depth, not the primary control -- that is dbt's lack of USAGE on
-- `app` (migration 040). Event triggers need superuser to install, so on managed Postgres
-- that refuses it this block warns and continues rather than failing the whole migration.
-- `doctor` reports its absence.

DO $$
BEGIN
    CREATE OR REPLACE FUNCTION ops.guard_ddl() RETURNS event_trigger
    LANGUAGE plpgsql AS $guard$
    DECLARE obj record;
    BEGIN
        IF current_user <> 'undercroft_dbt' THEN RETURN; END IF;
        FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands() LOOP
            IF obj.schema_name IS NOT NULL
               AND obj.schema_name NOT IN ('analytics', 'dq')
               AND obj.schema_name NOT LIKE 'dbt|_%' ESCAPE '|' THEN
                RAISE EXCEPTION
                    'undercroft: % may not create objects outside analytics/dq (attempted %, in %)',
                    current_user, obj.object_identity, obj.schema_name;
            END IF;
        END LOOP;
    END
    $guard$;

    IF NOT EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname = 'undercroft_guard_ddl') THEN
        CREATE EVENT TRIGGER undercroft_guard_ddl ON ddl_command_end
            EXECUTE FUNCTION ops.guard_ddl();
    END IF;
EXCEPTION
    WHEN insufficient_privilege OR feature_not_supported THEN
        RAISE WARNING 'undercroft: DDL guard event trigger not installed (%). '
            'The primary control -- dbt has no USAGE on app -- still holds.', SQLERRM;
END
$$;

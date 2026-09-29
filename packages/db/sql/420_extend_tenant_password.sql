-- Lengthening a tenant login's password without changing it. ADR 0087.
--
-- `ops.rotate_tenant_password` (080) sets a NEW password, and a Postgres role has exactly one:
-- every build or session still to authenticate with the previous value is refused. That is how
-- a raw-lake query opened while `dbt build` was parsing locked the build out of its own login.
-- The worker now rotates only when no build or session of that login is running, and the ones
-- that overlap share one password (`apps/worker/src/services/tenantSession.ts`).
--
-- A holder that needs the login for longer than the shared password has left -- a build that
-- joins a burst of queries late -- cannot rotate without refusing the others, so it extends the
-- password here instead: the same password, a later VALID UNTIL, never an earlier one. Like the
-- rotation it is SECURITY DEFINER and the worker's alone; it reads no password and returns none.
CREATE OR REPLACE FUNCTION ops.extend_tenant_password(
    p_tenant_id text,
    p_kind      text,
    p_valid_for interval
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, ops AS $fn$
DECLARE
    v_role  name;
    v_until timestamptz;
BEGIN
    SELECT role_name INTO v_role FROM ops.tenant_role
    WHERE tenant_id = p_tenant_id AND kind = p_kind;
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'undercroft: no % role for tenant %', p_kind, p_tenant_id
            USING ERRCODE = 'no_data_found';
    END IF;

    SELECT greatest(rolvaliduntil, clock_timestamp() + p_valid_for) INTO v_until
    FROM pg_roles WHERE rolname = v_role;
    EXECUTE format('ALTER ROLE %I VALID UNTIL %L', v_role, v_until::text);
END
$fn$;

REVOKE ALL ON FUNCTION ops.extend_tenant_password(text, text, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.extend_tenant_password(text, text, interval) TO undercroft_worker;

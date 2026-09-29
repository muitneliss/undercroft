-- What PgBouncer may learn about a login, to let it through. ADR 0088.
--
-- Tenant logins reach Postgres through PgBouncer, which queues a login instead of refusing it
-- and caps how many backends every tenant together may hold. Their passwords rotate (ADR 0087),
-- so no password file can list them: PgBouncer asks this function, as `undercroft_worker`, for
-- the login's stored SCRAM secret each time a client logs in, and checks the client's proof
-- against it. The secret is the one Postgres holds, which is what lets PgBouncer then log in to
-- Postgres with the client's own proof (SCRAM pass-through) and never see a password.
--
-- ONLY A LIVE TENANT LOGIN. A platform role (`undercroft_app`, the bootstrap superuser) gets no
-- row, so it cannot come in through the pooler even with its password; neither can a tenant
-- login whose password has expired, which is the check the lease's VALID UNTIL relies on.
-- `undercroft_worker` itself is PgBouncer's own login and is in its password file, not here.
--
-- SECURITY DEFINER because `pg_authid` is readable by superusers alone; owned, like the rotation
-- beside it (080), by the bootstrap role that runs migrations.
CREATE OR REPLACE FUNCTION ops.pgbouncer_auth(p_user text)
RETURNS TABLE (usename text, passwd text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, ops AS $fn$
    SELECT a.rolname::text, a.rolpassword
    FROM pg_authid a
    JOIN ops.tenant_role t ON t.role_name = a.rolname
    WHERE a.rolname = p_user
      AND a.rolcanlogin
      AND a.rolpassword IS NOT NULL
      AND (a.rolvaliduntil IS NULL OR a.rolvaliduntil > now())
$fn$;

REVOKE ALL ON FUNCTION ops.pgbouncer_auth(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.pgbouncer_auth(text) TO undercroft_worker;

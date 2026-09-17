-- Roles. See .claude/rules/privileges.md for the whole of the reasoning.
--
-- The owner is NOLOGIN. Nothing connects as the role that owns every object; a login
-- role that owns everything is a role whose password is the database. Migrations SET ROLE
-- to it. Every other role is a narrow login identity for one service.
--
-- Passwords are set out of band (never in git), so a half-applied migration leaves no
-- usable account rather than an open one.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'undercroft_owner') THEN
        CREATE ROLE undercroft_owner NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'undercroft_app') THEN
        CREATE ROLE undercroft_app LOGIN;      -- the control plane
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'undercroft_worker') THEN
        CREATE ROLE undercroft_worker LOGIN;   -- ingest, lake API, the raw loader
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'undercroft_dbt') THEN
        CREATE ROLE undercroft_dbt LOGIN;      -- dbt, and only dbt
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'undercroft_bi') THEN
        CREATE ROLE undercroft_bi LOGIN;       -- Metabase and any other BI tool
    END IF;
END
$$;

-- Nothing is granted to PUBLIC. Every privilege below is explicit.
REVOKE ALL ON SCHEMA public FROM PUBLIC;

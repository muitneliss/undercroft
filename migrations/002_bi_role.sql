-- The BI identity Metabase connects with.
--
-- Read-only, and deliberately narrower than "all our data":
--
--   curated.*  yes -- the analytical tables are what BI is for.
--   ops.*      yes -- freshness and run health belong on a dashboard. A figure
--                     with no visible age invites someone to act on a stale one.
--   dq.*       NO  -- quarantine rows carry the original source payload. That is
--                     raw customer content, and a BI role that can read it turns
--                     every dashboard user into someone with access to
--                     unreviewed source data.
--   raw lake   NO  -- not reachable from Postgres at all, by construction.
--
-- No password here. Passwords do not go in git, even for local development.
-- `vcdo migrate` sets it from VCDO_METABASE_RO_PASSWORD after this runs.

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'metabase_ro') THEN
        -- LOGIN but no password: the role cannot authenticate until a password
        -- is set out of band, so a half-applied migration leaves no usable
        -- account rather than an open one.
        CREATE ROLE metabase_ro LOGIN;
    END IF;
END
$$;

GRANT CONNECT ON DATABASE vcdo TO metabase_ro;

GRANT USAGE ON SCHEMA curated TO metabase_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA curated TO metabase_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA curated GRANT SELECT ON TABLES TO metabase_ro;

GRANT USAGE ON SCHEMA ops TO metabase_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA ops TO metabase_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA ops GRANT SELECT ON TABLES TO metabase_ro;

-- Explicitly revoke, rather than relying on never having granted. A later
-- migration that grants broadly would otherwise silently open this up.
REVOKE ALL ON SCHEMA dq FROM metabase_ro;

COMMIT;

-- The whole of the grant model. See .claude/rules/privileges.md.
--
-- The hazard this migration exists to close: `ALTER DEFAULT PRIVILEGES IN SCHEMA x ...`
-- with no `FOR ROLE` attaches the default to whichever role runs the migration. Under a
-- system where dbt creates tables at runtime, that makes grants unpredictable rather than
-- merely broad. So there is EXACTLY ONE `ALTER DEFAULT PRIVILEGES` in this database, and
-- it is scoped three ways: FOR ROLE (only dbt's objects), IN SCHEMA (only analytics), ON
-- TABLES. A gate test enumerates pg_default_acl and fails if a second one ever appears.

-- dbt owns the schemas it writes, and is the only role that may create anything in them.
CREATE SCHEMA IF NOT EXISTS analytics AUTHORIZATION undercroft_dbt;
CREATE SCHEMA IF NOT EXISTS dq        AUTHORIZATION undercroft_dbt;

-- -- app: control plane, plus the worker's narrow slice ----------------------
GRANT USAGE ON SCHEMA app TO undercroft_app, undercroft_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO undercroft_app;
-- The worker refreshes rotating tokens, so it needs UPDATE on exactly one table, and
-- SELECT on the ingest keys it authenticates against. Nothing else in app.
GRANT SELECT, UPDATE ON app.connection_secret TO undercroft_worker;
GRANT SELECT ON app.ingest_key TO undercroft_worker;

-- -- ops ---------------------------------------------------------------------
GRANT USAGE ON SCHEMA ops TO undercroft_app, undercroft_worker, undercroft_bi;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ops TO undercroft_app;
GRANT SELECT ON ops.tenant, ops.connection TO undercroft_worker;
GRANT INSERT, UPDATE ON ops.run TO undercroft_worker;
GRANT INSERT ON ops.audit_log TO undercroft_worker;
-- Freshness and run health belong on a dashboard, so BI reads ops -- but only these
-- named tables, never app and never raw.
GRANT SELECT ON ops.tenant, ops.connection, ops.run TO undercroft_bi;

-- -- raw: one writer, one reader --------------------------------------------
-- BI has NO usage on raw: payloads are unreviewed source content, the same argument that
-- keeps BI out of dq.
GRANT USAGE ON SCHEMA raw TO undercroft_worker, undercroft_dbt, undercroft_app;
GRANT SELECT, INSERT, UPDATE ON raw.records, raw.documents, raw.load_cursor TO undercroft_worker;
GRANT SELECT ON raw.records, raw.documents TO undercroft_dbt;
GRANT SELECT ON raw.records TO undercroft_app;   -- the UI previews a record

-- -- analytics + dq: dbt writes, BI reads analytics only --------------------
GRANT USAGE ON SCHEMA analytics TO undercroft_bi;
GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO undercroft_bi;

-- >>> THE ONLY ALTER DEFAULT PRIVILEGES IN THE DATABASE <<<
-- FOR ROLE undercroft_dbt is load-bearing: default privileges apply to the CREATING role,
-- so without it a table dbt creates at runtime would not be granted and every dashboard
-- would break on the first new model.
ALTER DEFAULT PRIVILEGES FOR ROLE undercroft_dbt IN SCHEMA analytics
    GRANT SELECT ON TABLES TO undercroft_bi;

-- dq holds dbt's store_failures output -- rejected rows WITH their source payload. BI has
-- no USAGE and no default privilege here, so a failing test never hands raw data to a
-- dashboard user.
REVOKE ALL ON SCHEMA dq FROM undercroft_bi;

-- Explicit refusals, so a later broad grant is a visible contradiction rather than a
-- silent widening.
REVOKE ALL ON SCHEMA app FROM undercroft_bi, undercroft_dbt;
REVOKE ALL ON SCHEMA raw FROM undercroft_bi;

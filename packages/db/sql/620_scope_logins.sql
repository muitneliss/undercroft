-- Scope logins: a reader who reaches only some of a customer's models reads as a login that can
-- see only those. ADR 0142.
--
-- A customer's reports are read as its BI login, `undercroft_bi_<slug>`, which reads every table
-- in `analytics_<slug>` (ADR 0018). A person given a few models (`model:<name>` grants, 610) must
-- not, and the only boundary a stranger's SQL cannot talk its way past is WHICH LOGIN it is
-- (`privileges.md`): a session setting can be `set_config`'d from inside a SELECT, and a
-- `SET ROLE` can be `RESET`. So a reader whose reach is narrower than the whole customer reads as
-- a SCOPE LOGIN, `undercroft_bi_<slug>__<hash7>`, granted SELECT on exactly the tables of the
-- models they reach. Everyone whose reach is the same set shares one.
--
-- What is HERE is what is applied once: the table that records each scope login, and the three
-- functions that admit a login -- the password's rotation, its extension, and the pooler's
-- question -- taught to admit a scope login exactly as they admit a tenant's two. What a scope
-- login may READ is a policy, stated on every deploy, and lives where every tenant grant lives:
-- `ops.provision_scope` in `repeatable/010_provision_tenant.sql` (ADR 0036).

-- ## ops.tenant_scope: which scope logins a customer has, and what each one reaches
--
-- `scope_hash` is the SHA-256 of the scope's canonical text (`ops.scope_canonical`, in the
-- repeatable file), so one reach is one row and one login whoever asks for it. `role_name` carries
-- its first seven hex characters; two different scopes of one customer that agreed on those would
-- be one name, and `provision_scope` refuses the second rather than merge them. `models` is the
-- canonical set, sorted, as the login was granted it.
--
-- `last_used_at` is when a reader last opened a session as it. A scope nobody has used for a
-- week, with no live password and no backend, is dropped when its customer is next provisioned
-- (`ops.drop_stale_scopes`): reach changes as grants do, and a login per set anybody ever held
-- would only grow. The next person to need that set gets it back on their first read.
--
-- Like `ops.tenant_role`, the row goes with its customer and the login stays: a deleted
-- customer's logins are an operator's to drop, as the tenant's own two are.
CREATE TABLE ops.tenant_scope (
    tenant_id    text        NOT NULL REFERENCES ops.tenant(id) ON DELETE CASCADE,
    scope_hash   text        NOT NULL CHECK (scope_hash ~ '^[0-9a-f]{64}$'),
    role_name    name        NOT NULL UNIQUE,
    models       text[]      NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, scope_hash)
);
-- Granted to nobody: which logins exist is operational, and only the functions below and in the
-- repeatable file -- each SECURITY DEFINER, owned by the role that applies migrations -- read or
-- write it.

-- ## A scope login's password is leased like a tenant login's (ADR 0087)
--
-- One more argument: the login, for `p_kind = 'scope'`, which must be one of the customer's own
-- scope logins. Dropped and created rather than overloaded: beside the three-argument version a
-- four-argument one with a default would make every existing call ambiguous. A call from a worker
-- that predates this one still resolves, to the default.
DROP FUNCTION ops.rotate_tenant_password(text, text, interval);
CREATE FUNCTION ops.rotate_tenant_password(
    p_tenant_id text,
    p_kind      text,
    p_valid_for interval DEFAULT interval '1 hour',
    p_login     name     DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, ops AS $fn$
DECLARE
    v_role     name;
    v_password text;
BEGIN
    v_role := ops.tenant_login(p_tenant_id, p_kind, p_login);
    -- 256 bits from pg_strong_random, hex, no separators.
    v_password := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    EXECUTE format('ALTER ROLE %I PASSWORD %L VALID UNTIL %L',
                   v_role, v_password, (clock_timestamp() + p_valid_for)::text);
    RETURN v_password;
END
$fn$;

DROP FUNCTION ops.extend_tenant_password(text, text, interval);
CREATE FUNCTION ops.extend_tenant_password(
    p_tenant_id text,
    p_kind      text,
    p_valid_for interval,
    p_login     name DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, ops AS $fn$
DECLARE
    v_role  name;
    v_until timestamptz;
BEGIN
    v_role := ops.tenant_login(p_tenant_id, p_kind, p_login);
    SELECT greatest(rolvaliduntil, clock_timestamp() + p_valid_for) INTO v_until
    FROM pg_roles WHERE rolname = v_role;
    EXECUTE format('ALTER ROLE %I VALID UNTIL %L', v_role, v_until::text);
END
$fn$;

-- The one answer to "which login is this", for the two functions above: a tenant's `dbt` or `bi`
-- login from `ops.tenant_role`, or -- for `scope` -- the named login, only if it is one of THIS
-- customer's scope logins and still exists. Anything else raises, so neither function can be
-- pointed at a platform role or at another customer's login by naming it.
CREATE FUNCTION ops.tenant_login(p_tenant_id text, p_kind text, p_login name) RETURNS name
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, ops AS $fn$
DECLARE
    v_role name;
BEGIN
    IF p_kind = 'scope' THEN
        SELECT s.role_name INTO v_role FROM ops.tenant_scope s
        WHERE s.tenant_id = p_tenant_id AND s.role_name = p_login
          AND EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = s.role_name);
    ELSE
        SELECT role_name INTO v_role FROM ops.tenant_role
        WHERE tenant_id = p_tenant_id AND kind = p_kind;
    END IF;
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'undercroft: no % login % for tenant %', p_kind, coalesce(p_login, ''), p_tenant_id
            USING ERRCODE = 'no_data_found';
    END IF;
    RETURN v_role;
END
$fn$;

REVOKE ALL ON FUNCTION ops.tenant_login(text, text, name) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.rotate_tenant_password(text, text, interval, name) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.rotate_tenant_password(text, text, interval, name) TO undercroft_worker;
REVOKE ALL ON FUNCTION ops.extend_tenant_password(text, text, interval, name) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.extend_tenant_password(text, text, interval, name) TO undercroft_worker;

-- ## The pooler admits a live scope login as it admits a tenant login (ADR 0088)
--
-- The same answer, from either table: a login the platform made for a customer, whose password
-- has not expired. A platform role is in neither, and a dropped scope login has no row.
CREATE OR REPLACE FUNCTION ops.pgbouncer_auth(p_user text)
RETURNS TABLE (usename text, passwd text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, ops AS $fn$
    SELECT a.rolname::text, a.rolpassword
    FROM pg_authid a
    WHERE a.rolname = p_user
      AND a.rolcanlogin
      AND a.rolpassword IS NOT NULL
      AND (a.rolvaliduntil IS NULL OR a.rolvaliduntil > now())
      AND (EXISTS (SELECT 1 FROM ops.tenant_role t WHERE t.role_name = a.rolname)
           OR EXISTS (SELECT 1 FROM ops.tenant_scope s WHERE s.role_name = a.rolname))
$fn$;

-- ## The search narrows to the streams its reader reaches, before it ranks (ADR 0142)
--
-- `lake.search` for a reader who reaches some raw streams and not others. The streams are a
-- PARAMETER of the candidate lookups (530), applied with the tenant's own condition and before
-- the cap: narrowing the page afterwards would rank and count matches the reader cannot see, and
-- the page, the `capped` note and `truncated` would all describe a lake that is not theirs.
--
-- `p_sources` and `p_entities` are parallel: one stream per position, an entity NULL meaning the
-- whole source. NULL arrays are the whole lake -- what a call from a worker that predates this
-- one means, because it passes three arguments and the defaults stand in.
DROP FUNCTION raw.search_record_candidates(name, text, integer);
CREATE FUNCTION raw.search_record_candidates(
    p_role     name,
    p_q        text,
    p_limit    integer,
    p_sources  text[] DEFAULT NULL,
    p_entities text[] DEFAULT NULL
)
    RETURNS TABLE (source text, entity text, source_record_id text, ordinal bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = pg_catalog, raw
    SET enable_seqscan = off
AS $$
    SELECT m.source, m.entity, m.source_record_id,
           row_number() OVER (ORDER BY m.observed_at DESC, m.source, m.entity, m.source_record_id)
    FROM (
        SELECT r.source, r.tenant_id, r.entity, r.source_record_id, r.observed_at
        FROM raw.records r
        WHERE raw.record_tsv(r.payload) @@ raw.search_query(p_q)
        OFFSET 0
    ) m
    WHERE m.tenant_id = (SELECT raw.tenant_of(p_role))
      AND (p_sources IS NULL OR EXISTS (
            SELECT 1 FROM unnest(p_sources, p_entities) AS s(source, entity)
            WHERE s.source = m.source AND (s.entity IS NULL OR s.entity = m.entity)))
    ORDER BY 4
    LIMIT p_limit
$$;

-- A document is reached as its source's `documents` stream: the entity a run's ledger counts its
-- catalogue under, and the one `raw:<source>/documents` names.
DROP FUNCTION raw.search_document_candidates(name, text, integer);
CREATE FUNCTION raw.search_document_candidates(
    p_role     name,
    p_q        text,
    p_limit    integer,
    p_sources  text[] DEFAULT NULL,
    p_entities text[] DEFAULT NULL
)
    RETURNS TABLE (source text, document_id text, ordinal bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = pg_catalog, raw
    SET enable_seqscan = off
AS $$
    SELECT m.source, m.document_id,
           row_number() OVER (ORDER BY m.dated DESC, m.source, m.document_id)
    FROM (
        SELECT t.source, t.tenant_id, t.document_id,
               coalesce(d.observed_at, t.extracted_at) AS dated
        FROM (
            SELECT t.source, t.tenant_id, t.document_id, t.extracted_at
            FROM raw.document_text t
            WHERE raw.search_tsv(t.text) @@ raw.search_query(p_q)
            OFFSET 0
        ) t
        LEFT JOIN raw.documents d
               ON d.source = t.source AND d.tenant_id = t.tenant_id
              AND d.document_id = t.document_id
    ) m
    WHERE m.tenant_id = (SELECT raw.tenant_of(p_role))
      AND (p_sources IS NULL OR EXISTS (
            SELECT 1 FROM unnest(p_sources, p_entities) AS s(source, entity)
            WHERE s.source = m.source AND (s.entity IS NULL OR s.entity = 'documents')))
    ORDER BY 3
    LIMIT p_limit
$$;

-- PUBLIC revoked; each tenant's dbt login is granted them in ONE place, the repeatable
-- `010_provision_tenant.sql`, which names these signatures.
REVOKE ALL ON FUNCTION raw.search_record_candidates(name, text, integer, text[], text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION raw.search_document_candidates(name, text, integer, text[], text[]) FROM PUBLIC;

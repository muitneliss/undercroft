-- Which rows a search ranks: the newest matches, found through the index. ADR 0123.
--
-- WHY THESE EXIST. 190 built a GIN index for the search and the search never used it. The
-- statement runs as the tenant's own dbt login, so the row-level policy on `raw` is in force,
-- and Postgres will not let a NON-LEAKPROOF operator become an index condition ahead of a
-- policy's condition -- the operator could otherwise see, and leak through an error, a row the
-- policy was about to hide. `@@` (`ts_match_vq`) is not leakproof. So as the tenant login every
-- search, for a rare word as much as a common one, was a scan that rebuilt the folded tsvector
-- of EVERY row the tenant owned -- up to 200,000 characters each, twice -- and the lake that
-- grew past fifteen seconds of that answered no search at all (#447). The plan test in
-- `rawSearch.test.ts` ran as the superuser, which bypasses the policy, and so never saw it.
--
-- WHAT THEY DO. One function per half of the lake, each answering exactly one question: "which
-- of MY rows match this, newest first, at most n of them". They run as their owner -- the
-- bootstrap superuser that applies the migrations, as `raw.tenant_of` and
-- `ops.rotate_tenant_password` do -- so the policy does not stand between `@@` and the index.
--
-- WHY THAT KEEPS THE BOUNDARY. Three things, each load-bearing:
--
--   1. WHOSE rows is decided by `raw.tenant_of(p_role)`, the policy's own function, which
--      answers only when `session_user` is a member of `p_role`. A tenant login passing
--      another tenant's role name gets NULL and therefore no row. The caller passes
--      `current_user`, exactly as the policy does; nothing in the session can forge it.
--   2. They return KEYS and an ordinal, never a value. No payload, no text, no date leaves
--      the function. Everything a reader is shown -- the rank, the excerpt, the dates -- is read
--      afterwards by the caller, AS the tenant login, joining these keys back to the tables
--      under the policy. A key the policy would not show joins to nothing.
--   3. The body is fixed. The reader's text arrives as a bound `tsquery` source and runs
--      through `raw.search_query`; no expression a tenant wrote is ever evaluated over a row
--      of another tenant, which is the leak the leakproof rule exists to prevent.
--
-- WHY NEWEST. Ranking every match is what took the time, so a search ranks a bounded set, and
-- the set has to be one a reader can be told about in a sentence. The newest n -- by the date
-- the hit itself shows -- is that sentence, is the likeliest set to hold what an operator is
-- looking for, is a TOTAL order (so page two of the same search ranks the same set as page
-- one), and costs nothing to compute: the index finds the matches and the heap gives their
-- dates, with no tsvector rebuilt. The caller says when the cut happened; see
-- `apps/worker/src/repos/rawSearch.ts`.
--
-- WHY THE FENCE AND `enable_seqscan = off`. The planner prices `raw.record_tsv(payload)` as
-- nearly free -- the function is inlined, and `to_tsvector` is costed like a comparison -- so
-- given a selective `tenant_id` condition it prefers the tenant btree and a FILTER that
-- rebuilds the vector for every one of the tenant's rows, which is the plan this file exists to
-- end. `OFFSET 0` keeps the tenant condition out of the scan, so the index scan on `@@` is the
-- only index path; switching sequential scans off makes it the only path at all. Both apply to
-- this body alone.
--
-- The `@@` expression is spelled here exactly as the indexes in 190 spell theirs. A second
-- spelling is an index that quietly stops being used; `rawSearch.test.ts` watches the scan.

CREATE OR REPLACE FUNCTION raw.search_record_candidates(p_role name, p_q text, p_limit integer)
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
    ORDER BY 4
    LIMIT p_limit
$$;

-- A document is dated as its hit is: the catalogue's `observed_at`, or `extracted_at` when the
-- catalogue row has gone (the search's own LEFT JOIN and `coalesce`, for the same reason).
CREATE OR REPLACE FUNCTION raw.search_document_candidates(p_role name, p_q text, p_limit integer)
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
    ORDER BY 3
    LIMIT p_limit
$$;

-- `privileges.md`: PUBLIC revoked, and the grant to each tenant's dbt login is made in ONE place,
-- `repeatable/010_provision_tenant.sql`, so it reaches the tenants that exist and every one
-- created later. Nobody else is granted these: the platform roles see every row already and
-- have no use for a function whose whole point is a tenant's own rows, and `undercroft_bi` has
-- no USAGE on `raw` at all.
REVOKE ALL ON FUNCTION raw.search_record_candidates(name, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION raw.search_document_candidates(name, text, integer) FROM PUBLIC;

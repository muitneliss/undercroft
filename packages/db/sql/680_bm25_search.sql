-- A document search ranks through two BM25 indexes per tenant, behind a door. ADR 0155, as
-- amended by ADR 0156 (the measured facts that changed its decisions 1, 3 and 5).
--
-- WHAT THIS FILE IS. The extension, in a schema no customer login can use; the one derivation of
-- a tenant's index names and the statements that build them; the door a tenant's login ranks
-- through; and the answer to "may this tenant rank through the door yet". It changes nothing a
-- search does today: the worker still reads ADR 0123's candidates until its statement is switched
-- to the door (the next change). The indexes themselves are created by `ops.provision_tenant`
-- for a tenant with no documents yet, and by the `search-index` service for every other tenant
-- (`packages/db/src/services/searchIndexing.ts`), because a populated tenant's index can only be
-- built CONCURRENTLY, which no migration and no function can do.
--
-- IT FAILS LOUDLY WITHOUT THE PRELOAD. `CREATE EXTENSION pg_textsearch` needs the library in
-- `shared_preload_libraries`, which only the first-party Postgres image carries
-- (`deploy/Dockerfile.postgres`, ADR 0155). On `postgres:17-alpine` this file stops the migrate,
-- and that is the intent: a database that cannot rank this way must not look as if it could.
-- The gate's PGlite loads the extension in `packages/db/src/testing.ts`.
--
-- WHY THE EXTENSION LIVES IN A SCHEMA NOBODY ELSE MAY USE. BM25 scores carry corpus statistics,
-- and `to_bm25query(text, index_name)` accepts ANY index name without reading a row of it. The
-- spike measured the consequence: a tenant's dbt login wrote a table in its own analytics schema
-- -- which is what a dbt model is -- and scored its text against ANOTHER tenant's index. A word
-- the other tenant held scored -2.17, a word it did not hold scored 0: a membership oracle over
-- another customer's documents, which row-level security cannot stop because no row of the other
-- tenant is read. So `search_ext` grants USAGE to nobody, every extension object below is named
-- through it, and the only code that reaches it is this file's, running as its owner. The
-- explicit refusals live in `repeatable/010_provision_tenant.sql` (tenant and scope logins) and
-- below (the platform roles), so a later broad grant is a visible contradiction.

-- -- the extension ------------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS search_ext;
REVOKE ALL ON SCHEMA search_ext FROM PUBLIC;
REVOKE ALL ON SCHEMA search_ext FROM undercroft_app, undercroft_worker, undercroft_dbt, undercroft_bi;

CREATE EXTENSION IF NOT EXISTS pg_textsearch SCHEMA search_ext;

-- `IF NOT EXISTS` is satisfied by an extension in ANY schema, and one created in `public` would
-- leave every `search_ext.` name below unresolvable -- and the operators reachable by every
-- login that can use `public`. Refused rather than tolerated.
DO $$
BEGIN
    IF (SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
        WHERE e.extname = 'pg_textsearch') IS DISTINCT FROM 'search_ext' THEN
        RAISE EXCEPTION 'undercroft: pg_textsearch is installed outside the search_ext schema'
            USING ERRCODE = 'invalid_schema_definition';
    END IF;
END
$$;

-- -- the two index expressions --------------------------------------------------------------------
-- Each tenant has a `simple` index (Vietnamese: exact, folded syllables) and an `english` one
-- (stems: `contract` finds `contracts`), ADR 0155 decision 5. Both index the same folded text.
--
-- WHY THE ENGLISH ONE IS A FUNCTION OF ITS OWN (ADR 0156). Two BM25 indexes on the SAME
-- expression are ambiguous to the planner: it picks one, and a query whose `to_bm25query` names
-- the other fails ("query specifies index X but planner chose index Y"). Measured on the bench.
-- So the english index is declared on this wrapper, whose answer is exactly the simple index's
-- expression. The `SET` clause is load-bearing: it stops the planner inlining the body, and an
-- inlined wrapper would be the simple expression again, ambiguity included.
--
-- IMMUTABLE for the reason `raw.fold` is: the index holds its output. Never change what it
-- answers without a reindex and a new ADR.
CREATE OR REPLACE FUNCTION raw.search_text_english(t text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    SET search_path = pg_catalog, raw
AS $$ SELECT raw.fold(left(t, raw.search_cap())) $$;

-- The configurations a tenant is indexed in, in the one place they are listed.
CREATE OR REPLACE FUNCTION raw.search_index_configs() RETURNS SETOF text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ VALUES ('simple'), ('english') $$;

-- The SQL of a configuration's index expression over `p_column`. The door orders by it and the
-- build declares it, and an ORDER BY spelled differently from its index is an index that is not
-- used -- every row is then scored from its text, about 2.3 ms each. NULL for an unknown one.
CREATE OR REPLACE FUNCTION raw.search_index_expression(p_config text, p_column text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT CASE p_config
        WHEN 'simple'  THEN format('raw.fold(left(%s, raw.search_cap()))', p_column)
        WHEN 'english' THEN format('raw.search_text_english(%s)', p_column)
    END
$$;

-- -- the one derivation of an index name ------------------------------------------------------------
-- From the TENANT, by hash, never by concatenating a slug: a 40-character slug plus a prefix
-- passes the 63-character identifier limit, Postgres truncates silently, and a door deriving the
-- name another way would then miss the index. `document_text_bm25_english_` is 27 characters and
-- the hash 16, so every name is 43 at most, whatever the tenant. Sixty-four bits of SHA-256 make
-- a collision between two tenants' names a non-event at any number of customers we will have.
-- NULL for a configuration that is not one of the two, so a typo names nothing.
CREATE OR REPLACE FUNCTION raw.search_index_name(p_tenant text, p_config text) RETURNS name
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT CASE WHEN p_config IN (SELECT raw.search_index_configs())
        THEN ('document_text_bm25_' || p_config || '_'
              || left(encode(sha256(convert_to(p_tenant, 'UTF8')), 'hex'), 16))::name
    END
$$;

-- The statements that make and mend a tenant's index, so the name, the expression, the
-- configuration and the predicate are written once for both builders:
--
--   create   in a transaction, for `ops.provision_tenant` (a tenant with no documents);
--   build    CONCURRENTLY, for `search-index` (no transaction, no function);
--   drop     CONCURRENTLY, for an invalid index a killed build left behind;
--   reindex  CONCURRENTLY, for an index that has grown (`VACUUM` gives no space back).
--
-- The predicate is the tenant id as a literal: a partial index is only used by a query whose
-- WHERE clause the planner can prove implies it, which a parameter cannot.
CREATE OR REPLACE FUNCTION raw.search_index_sql(p_tenant text, p_config text, p_verb text)
    RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT CASE p_verb
        WHEN 'create' THEN format(
            'CREATE INDEX IF NOT EXISTS %I ON raw.document_text USING bm25 (%s) '
            'WITH (text_config = %L) WHERE tenant_id = %L',
            x.name, x.expression, p_config, p_tenant)
        WHEN 'build' THEN format(
            'CREATE INDEX CONCURRENTLY IF NOT EXISTS %I ON raw.document_text USING bm25 (%s) '
            'WITH (text_config = %L) WHERE tenant_id = %L',
            x.name, x.expression, p_config, p_tenant)
        WHEN 'drop' THEN format('DROP INDEX CONCURRENTLY IF EXISTS raw.%I', x.name)
        WHEN 'reindex' THEN format('REINDEX INDEX CONCURRENTLY raw.%I', x.name)
    END
    FROM (SELECT raw.search_index_name(p_tenant, p_config) AS name,
                 raw.search_index_expression(p_config, 'text') AS expression) x
    WHERE x.name IS NOT NULL
$$;

-- -- readiness ----------------------------------------------------------------------------------------
-- Whether the caller's tenant can rank through the door: BOTH of its indexes exist and are valid
-- and ready. False while `search-index` has not reached the tenant, during a CONCURRENTLY build
-- (the index exists and is not yet valid), after a build was killed, and for a login that is not
-- a tenant's -- `raw.tenant_of` answers NULL for it, and NULL names no index. The worker asks this
-- first and reads ADR 0123's candidates when it is false (ADR 0156).
CREATE OR REPLACE FUNCTION raw.search_document_bm25_ready(p_role name) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = pg_catalog, raw
AS $$
    SELECT count(*) = (SELECT count(*) FROM raw.search_index_configs())
    FROM raw.search_index_configs() AS c(config)
    JOIN pg_class x
      ON x.relname = raw.search_index_name((SELECT raw.tenant_of(p_role)), c.config)
     AND x.relnamespace = 'raw'::regnamespace
    JOIN pg_index i ON i.indexrelid = x.oid
    WHERE i.indrelid = 'raw.document_text'::regclass AND i.indisvalid AND i.indisready
$$;

-- -- what the reader's words rank by ------------------------------------------------------------------
-- The POSITIVE terms of a websearch query, folded, as BM25 query text (ADR 0156).
--
-- BM25 ranks any term it is given and knows no operators. Given `-xe hop dong` whole, it ranked
-- the documents HOLDING `xe` first; the all-terms filter then removed every one of them, and the
-- search answered nothing. So what is ranked is what the reader wants present: negated words and
-- negated phrases removed, quotes and the `or` keyword dropped. What a query MEANS -- every term
-- required, a phrase kept together, a negation honoured -- is decided by the filter, through the
-- GIN index and `raw.search_query`, exactly as before. An empty answer means nothing to rank.
CREATE OR REPLACE FUNCTION raw.search_bm25_terms(q text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT btrim(regexp_replace(
        regexp_replace(
            regexp_replace(
                regexp_replace(raw.fold(q), '(^|\s)-"[^"]*"?', ' ', 'g'),
                '(^|\s)-\S*', ' ', 'g'),
            '"|(^|\s)or(?=\s|$)', ' ', 'g'),
        '\s+', ' ', 'g'))
$$;

-- -- the stream narrowing, spelled once for the two functions below -----------------------------------
-- The sources whose `documents` stream a reader reaches (ADR 0142): an entity of NULL is the
-- whole source, and a document is reached as its source's `documents` stream. NULL arrays are the
-- whole lake (NULL out); a reader who reaches no document stream gets an empty array, which
-- matches nothing. 620's candidate lookup keeps its own spelling of the same rule.
CREATE OR REPLACE FUNCTION raw.search_document_sources(p_sources text[], p_entities text[])
    RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT CASE WHEN p_sources IS NOT NULL THEN coalesce((
        SELECT array_agg(DISTINCT s.source)
        FROM unnest(p_sources, p_entities) AS s(source, entity)
        WHERE s.entity IS NULL OR s.entity = 'documents'), '{}')
    END
$$;

-- -- the all-terms filter, as keys ---------------------------------------------------------------------
-- Which of the caller's documents match the query -- every term, the phrases, the negations --
-- through the GIN index, as keys and in no order (ADR 0156).
--
-- 620's `raw.search_document_candidates` answers the same rows NEWEST FIRST, which costs a join
-- to `raw.documents` and a sort of every match for a page the door does not need: the door only
-- asks "is this key a match". Otherwise it is that function, guarantee for guarantee, and 530's
-- header is the argument for each: whose rows is `raw.tenant_of(p_role)`, which answers only for
-- a role `session_user` belongs to; it returns keys, never a value; its body is fixed and the
-- reader's text arrives as a parameter; `OFFSET 0` keeps the tenant condition out of the scan and
-- `enable_seqscan = off` leaves the GIN index as the only path. Measured on the bench, the door's
-- semi-join with these keys cost 100-353 ms whatever the depth; re-testing each ranked row with
-- `@@` instead rebuilt its vector, 2-8 s at a depth of 3,000.
CREATE OR REPLACE FUNCTION raw.search_document_matches(
    p_role     name,
    p_q        text,
    p_sources  text[] DEFAULT NULL,
    p_entities text[] DEFAULT NULL
)
    RETURNS TABLE (source text, document_id text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = pg_catalog, raw
    SET enable_seqscan = off
AS $$
    SELECT m.source, m.document_id
    FROM (
        SELECT t.source, t.tenant_id, t.document_id
        FROM raw.document_text t
        WHERE raw.search_tsv(t.text) @@ raw.search_query(p_q)
        OFFSET 0
    ) m
    WHERE m.tenant_id = (SELECT raw.tenant_of(p_role))
      AND (p_sources IS NULL
           OR m.source = ANY (raw.search_document_sources(p_sources, p_entities)))
$$;

-- -- the ranked head of one index -----------------------------------------------------------------------
-- How deep each index's BM25 order is read: a stated budget, the way the cap is (ADR 0156).
-- Measured on the bench (real Postgres 17, 1 GB, a tenant of 172,000 documents): at 10,000 every
-- tested query's page was the page a depth of 20,000 gave, and the whole fused search took
-- 130-353 ms. Deeper buys nothing measured; shallower risks a page the door must refuse.
CREATE OR REPLACE FUNCTION raw.search_bm25_depth() RETURNS integer
    LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT 10000 $$;

-- The statement that reads one tenant's keys in one index's BM25 order, best first, at most the
-- depth of them. A function of its own so that the test which asks Postgres for its plan asks
-- about the statement that runs, not a copy (the extension's scans move no scan counter).
--
-- KEYS ONLY. `<@>` is in the ORDER BY alone, where the extension answers it from the index; in a
-- select list it re-scores the row from its text, about 2.3 ms a row (10,000 rows: 23.4 s against
-- 46 ms).
--
-- EVERYTHING IS A CONSTANT. The tenant (so the planner can prove the partial index's predicate),
-- the query text and the index name, all spliced as literals with `%L`. A query or an index name
-- that is not a constant loses the index order, and every row is then scored from its text. The
-- streams narrow the scan here, BEFORE the order is read, so the depth is spent on documents the
-- reader reaches (ADR 0142); the extension grows its batch until the LIMIT is filled.
CREATE OR REPLACE FUNCTION raw.search_document_bm25_head_sql(
    p_tenant  text,
    p_config  text,
    p_terms   text,
    p_sources text[]
)
    RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path = pg_catalog, raw
AS $$
    SELECT format(
        'SELECT t.source, t.document_id FROM raw.document_text t '
        'WHERE t.tenant_id = %L %s '
        'ORDER BY %s OPERATOR(search_ext.<@>) search_ext.to_bm25query(%L, %L) '
        'LIMIT %s',
        p_tenant,
        CASE WHEN p_sources IS NULL THEN ''
             ELSE format('AND t.source = ANY (%L::text[])', p_sources) END,
        raw.search_index_expression(p_config, 't.text'),
        p_terms,
        format('raw.%I', raw.search_index_name(p_tenant, p_config)),
        raw.search_bm25_depth())
$$;

-- That statement's rows, which the door numbers `WITH ORDINALITY` -- numbering rows in the order
-- this function returned them, and RETURN QUERY returns them in the order the query produced
-- them. That is a guarantee; numbering an ordered subquery with `row_number() OVER ()` would only
-- usually be one.
--
-- WHY SEQUENTIAL SCANS AND SORTS ARE OFF, for this function's own statement alone. At a LIMIT as
-- deep as the depth, the planner may price "scan the tenant's rows by another index, score each
-- from its text, sort" below the BM25 index scan -- it does on a small table -- and that plan
-- costs about 2.3 ms a row on a large one. With both off, the ordered index scan is the only
-- path. The door's own fusion and sort run under the door's settings, not these.
--
-- INTERNAL, like the statement above. It takes a tenant id, not a role, so it decides nothing
-- about who is asking: no grant to anyone, and only the door below -- running as this function's
-- owner -- calls it.
CREATE OR REPLACE FUNCTION raw.search_document_bm25_head(
    p_tenant  text,
    p_config  text,
    p_terms   text,
    p_sources text[]
)
    RETURNS TABLE (source text, document_id text)
    LANGUAGE plpgsql STABLE
    SET search_path = pg_catalog, raw
    SET enable_seqscan = off
    SET enable_sort = off
AS $fn$
BEGIN
    RETURN QUERY EXECUTE raw.search_document_bm25_head_sql(p_tenant, p_config, p_terms, p_sources);
END
$fn$;

-- -- the door -----------------------------------------------------------------------------------------
-- One page of the caller's documents in BM25 order: keys and a 1-based ordinal, nothing else.
--
-- HOW IT RANKS (ADR 0155 decision 5, ADR 0156). Each of the tenant's two indexes yields its head
-- in BM25 order; the two orders are fused by reciprocal rank fusion -- a key scores
-- 1 / (60 + its rank) in each list it appears in, summed; 60 is the constant the method was
-- published with -- and the fused order is kept to the keys that MATCH (the semi-join with
-- `raw.search_document_matches`), so the query language is today's. Ties fall to the key, so the
-- order is total and every page of one search ranks the same set.
--
-- WHY THAT KEEPS THE BOUNDARY (530's three guarantees, and one more):
--
--   1. Whose rows is `raw.tenant_of(p_role)`. A login naming another tenant's role gets NULL
--      and is answered with nothing, before anything else is asked.
--   2. Keys and an ordinal leave, never a score or a value; the caller joins them back to the
--      tables AS the tenant, under the policy.
--   3. The body is fixed. The reader's text reaches SQL only as a literal (`%L`) or a parameter.
--   4. The index names are DERIVED from that tenant, here; nothing the caller passes names an
--      index, so a caller can only ever rank against its own statistics.
--
-- WHEN IT REFUSES, rather than answer a page that is not what it says (SQLSTATE 55000,
-- `object_not_in_prerequisite_state`; the caller then ranks ADR 0123's way):
--
--   - the tenant's indexes are not both valid and ready -- ask `raw.search_document_bm25_ready`
--     first, which makes this the rare case of an index dropped between the two calls;
--   - the page is shorter than asked while more documents match than it holds: those matches
--     lie past the depth of both heads (or the query has no positive term to rank, such as
--     `-xe` alone), and a short page would read as "no more hits".
--
-- `enable_seqscan = off` reaches the heads, so their index scans are the only path.
CREATE OR REPLACE FUNCTION raw.search_document_bm25(
    p_role     name,
    p_q        text,
    p_limit    integer,
    p_sources  text[] DEFAULT NULL,
    p_entities text[] DEFAULT NULL
)
    RETURNS TABLE (source text, document_id text, ordinal bigint)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path = pg_catalog, raw
    SET enable_seqscan = off
AS $fn$
#variable_conflict use_column
DECLARE
    v_tenant  text := raw.tenant_of(p_role);
    v_terms   text := coalesce(raw.search_bm25_terms(p_q), '');
    v_sources text[] := raw.search_document_sources(p_sources, p_entities);
    v_matched bigint := 0;
    v_n       bigint := 0;
    r         record;
BEGIN
    IF v_tenant IS NULL OR p_limit IS NULL OR p_limit < 1 THEN
        RETURN;
    END IF;
    IF NOT raw.search_document_bm25_ready(p_role) THEN
        RAISE EXCEPTION 'undercroft: the search indexes of % are not ready', v_tenant
            USING ERRCODE = 'object_not_in_prerequisite_state',
                  HINT = 'rank with raw.search_document_candidates (ADR 0123)';
    END IF;

    FOR r IN
        WITH matched AS MATERIALIZED (
                 SELECT k.source, k.document_id
                 FROM raw.search_document_matches(p_role, p_q, p_sources, p_entities) k),
             head AS (
                 SELECT h.source, h.document_id, 1.0 / (60 + h.r) AS w
                 FROM raw.search_document_bm25_head(v_tenant, 'simple', v_terms, v_sources)
                      WITH ORDINALITY AS h(source, document_id, r)
                 WHERE v_terms <> ''
                 UNION ALL
                 SELECT h.source, h.document_id, 1.0 / (60 + h.r)
                 FROM raw.search_document_bm25_head(v_tenant, 'english', v_terms, v_sources)
                      WITH ORDINALITY AS h(source, document_id, r)
                 WHERE v_terms <> ''),
             fused AS (
                 SELECT f.source, f.document_id, sum(f.w) AS score
                 FROM head f
                 GROUP BY f.source, f.document_id),
             page AS (
                 SELECT f.source, f.document_id,
                        row_number() OVER (ORDER BY f.score DESC, f.source, f.document_id) AS n
                 FROM fused f
                 WHERE EXISTS (SELECT 1 FROM matched m
                               WHERE m.source = f.source AND m.document_id = f.document_id)
                 ORDER BY 3
                 LIMIT p_limit)
        SELECT (SELECT count(*) FROM matched) AS matched, p.source, p.document_id, p.n
        FROM (SELECT 1) one
        LEFT JOIN page p ON true
        ORDER BY p.n
    LOOP
        v_matched := r.matched;
        IF r.n IS NOT NULL THEN
            source := r.source;
            document_id := r.document_id;
            ordinal := r.n;
            v_n := v_n + 1;
            RETURN NEXT;
        END IF;
    END LOOP;

    -- Refused before the rows above reach anyone: an exception discards what RETURN NEXT kept.
    IF v_n < p_limit AND v_matched > v_n THEN
        RAISE EXCEPTION 'undercroft: % documents match and the ranked heads hold % of them',
                v_matched, v_n
            USING ERRCODE = 'object_not_in_prerequisite_state',
                  HINT = 'rank with raw.search_document_candidates (ADR 0123)';
    END IF;
END
$fn$;

-- -- what search-index remembers ----------------------------------------------------------------------
-- Each index's size when it was last built, so "has it grown" has something to be measured
-- against: re-extraction grows a BM25 index and `VACUUM` gives nothing back (216 -> 362 MB for
-- 10% of a tenant's documents rewritten). Written and read by `search-index` alone, which runs as
-- the bootstrap role like the migrations, so it is granted to nobody -- stated here, because
-- `privileges.md` asks the file that makes a table to say who may use it.
CREATE TABLE IF NOT EXISTS ops.search_index_build (
    index_name  name        PRIMARY KEY,
    tenant_id   text        NOT NULL,
    config      text        NOT NULL,
    built_bytes bigint      NOT NULL,
    built_at    timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON ops.search_index_build FROM PUBLIC;

-- -- grants -------------------------------------------------------------------------------------------
-- PUBLIC revoked from every function here. The tenant's dbt login is granted the door, the
-- matches and the readiness in ONE place, `repeatable/010_provision_tenant.sql` (privileges.md,
-- ADR 0036). The rest are the door's and the builders' own, and the owner needs no grant.
REVOKE ALL ON FUNCTION raw.search_text_english(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION raw.search_index_configs() FROM PUBLIC;
REVOKE ALL ON FUNCTION raw.search_index_expression(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION raw.search_index_name(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION raw.search_index_sql(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION raw.search_document_bm25_ready(name) FROM PUBLIC;
REVOKE ALL ON FUNCTION raw.search_bm25_terms(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION raw.search_document_sources(text[], text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION raw.search_document_matches(name, text, text[], text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION raw.search_bm25_depth() FROM PUBLIC;
REVOKE ALL ON FUNCTION raw.search_document_bm25_head_sql(text, text, text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION raw.search_document_bm25_head(text, text, text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION raw.search_document_bm25(name, text, integer, text[], text[]) FROM PUBLIC;

-- The worker writes `raw.document_text`, and Postgres checks EXECUTE on an index expression's
-- function for whoever inserts the row. Without this, the first document landed for a tenant with
-- its indexes would be refused "permission denied for function search_text_english" -- the
-- reason 190 granted its vector functions to the worker too.
GRANT EXECUTE ON FUNCTION raw.search_text_english(text) TO undercroft_worker;

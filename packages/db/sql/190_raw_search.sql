-- Full-text search over the raw lake, in Vietnamese and in English.
--
-- The lake can say what landed and show one stream's rows. It could not answer the question an
-- operator actually arrives with -- "which of our data mentions this?" -- across every source at
-- once, and since ADR 0024 landed `raw.document_text` the answer is sitting in the database
-- unreachable behind a hand-written LIKE. This file is the index and the four functions that
-- make it reachable; ADR 0026 records the decisions.
--
-- WHY NO `unaccent`. The usual Postgres answer to Vietnamese diacritics is the `unaccent`
-- dictionary inside a custom text-search configuration. PGlite -- which is what the offline gate
-- runs, and therefore the only place these rules are enforced before production -- ships 21
-- contrib extensions and `unaccent` is not among them. A design that needed it would be proven
-- nowhere. So the folding is plain built-in SQL: `normalize` and `translate`, identical in
-- PGlite's PG 16 and in the managed database, with nothing to install on either.
--
-- WHY EXPRESSION INDEXES AND NOT A GENERATED COLUMN. `raw.records` is `PARTITION BY LIST` from
-- its first migration precisely so that a populated table never has to be rewritten under ACCESS
-- EXCLUSIVE (030's docstring). `ADD COLUMN ... GENERATED ... STORED` is exactly that rewrite. An
-- expression index on the partitioned parent propagates to the partitions that exist and to
-- every partition made later, and adds no column to a table whose payloads are already the
-- largest thing in the database.
--
-- WHO MAY RUN IT. Nobody new. The functions are granted to the roles that already hold SELECT on
-- these tables, and `undercroft_bi` gets nothing -- it has no USAGE on `raw` at all (040), so it
-- cannot even name them. A search reaches a reader through the tenant's own dbt login, the same
-- login the Lake Console already answers as, under the same row-level policy.

-- -- the cap ------------------------------------------------------------------------------
-- How much of one value is searchable, in characters.
--
-- `to_tsvector` raises above the 1 MB tsvector ceiling, and inside an EXPRESSION INDEX that
-- error is raised by the INSERT -- so an unguarded index would refuse to land the document it
-- was built to find. 200,000 characters is roughly a hundred pages of prose and folds to well
-- under the ceiling in any script. Past it, a value is searchable in its first 200,000
-- characters and not beyond: a stated limit rather than a silent one, and `raw.record_tsv`
-- falls back rather than going blank, because an unfindable row is worse than a truncated one.
--
-- A function rather than a literal in four places, so the cap has ONE definition. Postgres
-- inlines it, including inside the index expressions below.
CREATE OR REPLACE FUNCTION raw.search_cap() RETURNS integer
    LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT 200000 $$;

-- -- the fold -----------------------------------------------------------------------------
-- Vietnamese as an ASCII keyboard types it: `hop dong` finds `Hợp đồng`.
--
-- ONE CHARACTER IN, ONE CHARACTER OUT, and that is load-bearing rather than incidental:
-- `raw.search_excerpt` finds the match's offset in the FOLDED text and cuts the snippet out of
-- the ORIGINAL, so that a Vietnamese reader sees their own language back rather than the
-- stripped form. The moment folding changes a string's length the excerpt slides off the match
-- and returns a wrong answer that looks exactly like a right one. `rawSearch.test.ts` pins
-- `length(fold(x)) = length(normalize(x, NFC))` over a corpus for that reason.
--
-- Hence `translate` over a precomposed NFC string, and NOT the shorter `normalize(t, NFD)` +
-- strip-the-combining-marks: decomposition changes the length of every accented character, and
-- it leaves `đ` untouched -- it is a distinct letter, not d-with-a-mark -- which would leave most
-- of the words an operator types unsearchable from an ASCII keyboard.
--
-- `translate` runs BEFORE `lower()`, mapping both cases straight to lowercase ASCII, because
-- `lower()` on a non-ASCII character depends on the database's collation and PGlite's is not the
-- server's. Only A-Z is left for `lower()` to do, which every locale agrees about.
CREATE OR REPLACE FUNCTION raw.fold(t text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT lower(translate(
        normalize(t, NFC),
        -- Vietnamese, lowercase: a (17), e (11), i (5), o (17), u (11), y (5), d (1)
        'àáảãạăằắẳẵặâầấẩẫậ' || 'èéẻẽẹêềếểễệ' || 'ìíỉĩị' ||
        'òóỏõọôồốổỗộơờớởỡợ' || 'ùúủũụưừứửữự' || 'ỳýỷỹỵ' || 'đ' ||
        -- Vietnamese, uppercase: the same letters, the same order
        'ÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬ' || 'ÈÉẺẼẸÊỀẾỂỄỆ' || 'ÌÍỈĨỊ' ||
        'ÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢ' || 'ÙÚỦŨỤƯỪỨỬỮỰ' || 'ỲÝỶỸỴ' || 'Đ' ||
        -- The Latin-1 accents an English or French document brings with it. Ligatures (æ, œ,
        -- ß) are deliberately absent: expanding one would change the string's length, which is
        -- the one property this function may not lose.
        'äëïöüÿñçåîû' || 'ÄËÏÖÜŸÑÇÅÎÛ',

        'aaaaaaaaaaaaaaaaa' || 'eeeeeeeeeee' || 'iiiii' ||
        'ooooooooooooooooo' || 'uuuuuuuuuuu' || 'yyyyy' || 'd' ||
        'aaaaaaaaaaaaaaaaa' || 'eeeeeeeeeee' || 'iiiii' ||
        'ooooooooooooooooo' || 'uuuuuuuuuuu' || 'yyyyy' || 'd' ||
        'aeiouyncaiu' || 'aeiouyncaiu'
    ))
$$;

-- -- the vectors --------------------------------------------------------------------------
-- TWO CONFIGURATIONS, CONCATENATED, because the two languages want opposite things.
--
-- `simple` tokenises and does not stem, which is right for Vietnamese: it is an analytic
-- language whose syllables are already separate words, and an English stemmer let loose on them
-- only invents endings to remove. `english` stems, which is what makes a search for `contract`
-- find `signed contracts`. Running both and concatenating costs index size and buys a search box
-- that does not ask the reader which language the document was in -- which they generally do not
-- know before they search.
CREATE OR REPLACE FUNCTION raw.search_tsv(t text) RETURNS tsvector
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT to_tsvector('simple', raw.fold(left(t, raw.search_cap())))
        || to_tsvector('english', raw.fold(left(t, raw.search_cap())))
$$;

-- A record's VALUES, never its keys.
--
-- Indexing `payload::text` whole would put every field name in the index, so a search for `name`
-- returns every record the source has ever sent -- a result that is technically a match and
-- useless as an answer. `jsonb_to_tsvector` with a filter takes the values only, and folding the
-- payload's text form before re-reading it as jsonb is safe because folding only lowercases and
-- transliterates: it cannot make valid JSON invalid.
--
-- Past the cap it falls back to `raw.search_tsv` over the truncated text form. Keys creep into
-- the index for that row, which is a worse answer than the filtered one and a far better answer
-- than the row being unfindable.
CREATE OR REPLACE FUNCTION raw.record_tsv(p jsonb) RETURNS tsvector
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT CASE
        WHEN length(p::text) <= raw.search_cap() THEN
            jsonb_to_tsvector('simple', raw.fold(p::text)::jsonb, '["string","numeric"]')
         || jsonb_to_tsvector('english', raw.fold(p::text)::jsonb, '["string","numeric"]')
        ELSE raw.search_tsv(p::text)
    END
$$;

-- What the reader typed, in the same two configurations.
--
-- `websearch_to_tsquery` rather than `plainto_tsquery`: it gives quoted phrases and `-negation`
-- for the syntax every reader already knows from a search engine, and it never raises on
-- malformed input -- it returns an empty tsquery, which matches NOTHING. That is the right
-- answer for a blank box and the opposite of what a `LIKE '%%'` would have done.
CREATE OR REPLACE FUNCTION raw.search_query(q text) RETURNS tsquery
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT websearch_to_tsquery('simple', raw.fold(q))
        || websearch_to_tsquery('english', raw.fold(q))
$$;

-- -- the snippet --------------------------------------------------------------------------
-- A window onto the match, cut from the ORIGINAL text.
--
-- NOT `ts_headline`, which would have to be given the folded text and would therefore print
-- `hop dong thue nha` to an operator whose own language has just been stripped of its tones. The
-- offset is found in the folded text and applied to the NFC original, which is exactly what
-- `raw.fold` being length-preserving buys; highlighting is the caller's, over the same fold.
--
-- WHEN NO TERM APPEARS LITERALLY the excerpt is the head of the text, not a guess. A match can
-- be real while no query term is present verbatim -- `contract` matches `contracts` through the
-- English stemmer -- and an excerpt positioned on a guessed offset reads exactly like one
-- positioned on a found match. The head is visibly the beginning of the document; a wrong window
-- is not visibly anything.
CREATE OR REPLACE FUNCTION raw.search_excerpt(body text, q text, radius integer DEFAULT 90)
    RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT CASE WHEN s.at = 0
                THEN left(s.src, radius * 2)
                ELSE substr(s.src, greatest(s.at - radius, 1), radius * 2)
           END
    FROM (
        SELECT normalize(left(body, raw.search_cap()), NFC) AS src,
               coalesce((
                   SELECT min(position(term IN raw.fold(left(body, raw.search_cap()))))
                   FROM unnest(regexp_split_to_array(raw.fold(q), '[^[:alnum:]]+')) AS term
                   WHERE term <> ''
                     AND position(term IN raw.fold(left(body, raw.search_cap()))) > 0
               ), 0) AS at
    ) s
$$;

-- -- the indexes --------------------------------------------------------------------------
-- Declared on the PARTITIONED PARENT, so every partition that exists gets one and every
-- partition created for a new connector inherits it without a migration -- which is the same
-- property 030 partitioned the table for in the first place.
CREATE INDEX IF NOT EXISTS records_search ON raw.records USING gin (raw.record_tsv(payload));

CREATE INDEX IF NOT EXISTS document_text_search
    ON raw.document_text USING gin (raw.search_tsv(text));

-- -- grants -------------------------------------------------------------------------------
-- `privileges.md`: every grant explicit, PUBLIC revoked. A function is granted to PUBLIC by
-- default, and while these five are pure, leaving them so would make this the one place in the
-- database where a privilege was implied rather than written down.
REVOKE ALL ON FUNCTION raw.search_cap() FROM PUBLIC;
REVOKE ALL ON FUNCTION raw.fold(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION raw.search_tsv(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION raw.record_tsv(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION raw.search_query(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION raw.search_excerpt(text, text, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION raw.search_cap(), raw.fold(text), raw.search_tsv(text),
    raw.record_tsv(jsonb), raw.search_query(text), raw.search_excerpt(text, text, integer)
    TO undercroft_app, undercroft_worker, undercroft_dbt;

-- Nothing for `undercroft_bi`, which has no USAGE on `raw` and so cannot name these at all.
-- Stated rather than omitted, because a later reader adding a grant here should have to
-- contradict a sentence rather than fill in a gap.

-- -- the per-tenant grant ------------------------------------------------------------------
-- The same two-sided fix 180 records, for the same reason: `ops.provision_tenant` grants by
-- name, so its body in 080 is edited in place for fresh databases and every tenant provisioned
-- from here on, and the loop below covers the databases where 080 has already run and never
-- will again -- the ledger keys on the file's NAME and stores no checksum. `ops.tenant_role` is
-- the authority for which login belongs to which customer, so it is what the catch-up reads.
DO $$
DECLARE r record;
BEGIN
    FOR r IN SELECT role_name FROM ops.tenant_role WHERE kind = 'dbt' ORDER BY role_name LOOP
        EXECUTE format(
            'GRANT EXECUTE ON FUNCTION raw.search_cap(), raw.fold(text), raw.search_tsv(text),
                 raw.record_tsv(jsonb), raw.search_query(text),
                 raw.search_excerpt(text, text, integer) TO %I',
            r.role_name);
    END LOOP;
END
$$;

-- The fold, spelled for speed, and folded once: the same output, a fraction of the time.
-- ADR 0154.
--
-- WHY. `lake.search` ran into the worker's 15 s statement timeout in production on an ordinary
-- name. Measured read-only on production, in a tenant of 191,250 documents and 246,221 records
-- (Postgres 17.11), a search for a person's three-syllable name matched 10 records and 531 documents, and the
-- candidate lookups (530) found them through the index in 8 ms and 11 ms. The whole statement
-- took 17.07 s. Nearly all of it was what runs AFTER the lookups: ranking the 100 newest
-- documents (`ts_rank_cd` over a rebuilt `raw.search_tsv`; they averaged 36,037 characters)
-- took 9.6-10.0 s, and the excerpts for the 21-row page about 6.4-7.25 s. Both are dominated by
-- `raw.fold`: folding those 100 documents alone took 4.17 s.
--
-- 190 spelled the fold as `lower(translate(normalize(t, NFC), <list>, <list>))`. Postgres's
-- `translate` compares each character of the input against the whole from-list in turn, so it
-- costs O(characters x 150), and an ASCII character -- the majority of any document, Vietnamese
-- included -- walks the full list without matching. And 190 folded the same text more than once:
-- `raw.search_tsv` twice, `raw.record_tsv` twice, and `raw.search_excerpt` once per query term
-- and then once more per term.
--
-- WHAT CHANGES.
--
--   1. `raw.fold` is one `regexp_replace` per target letter, each with a bracket class of the
--      letters that become it. A class is matched in one step per input character, so each pass
--      is linear, and nine passes cost far less than one `translate` over the list.
--   2. `raw.search_tsv`, `raw.record_tsv` and `raw.search_excerpt` each fold their text EXACTLY
--      ONCE, behind an `OFFSET 0` fence (below).
--
-- Measured on production with the new fold alone: folding the 100 documents 4.17 s -> 1.04 s,
-- ranking them 9.97 s -> 3.62 s (the same `ts_rank_cd` sum), and the page's excerpts about
-- 6.4 s -> 0.2 s (the same total length). On a bench of real Postgres 17 (one 200,000-character
-- body), folding once besides: `raw.search_tsv` 70 ms -> 47 ms, and the excerpt for a
-- three-term query 99 ms -> 29 ms, each with an identical md5.
--
-- THE OUTPUT IS UNCHANGED, AND THAT IS LOAD-BEARING. Both GIN indexes in 190 hold the output of
-- `raw.search_tsv` and `raw.record_tsv`, which call `raw.fold`. Postgres trusts an IMMUTABLE
-- function to answer the same forever; replace its body with one that answers differently and
-- the indexes are silently stale -- a row found by one spelling and missed by the other, with no
-- error anywhere. So the mapping below is exactly 190's, letter for letter and in both cases,
-- every function here answers byte for byte what 190's did, and nothing needs a reindex. The
-- fold's equivalence was checked on the bench for every code point from 32 to 8,000 (Latin-1,
-- Latin Extended, the combining marks and the whole Vietnamese block U+1E00-1EFF) and over
-- 3,000 documents; `rawSearch.test.ts` pins the mapping itself, every letter written out, and
-- `scripts/fold.test.ts` reads THIS file, the definition that now runs, against the browser's
-- copy.
--
-- What 190 says about the fold still holds, because the output is the same:
--
--   - ONE CHARACTER IN, ONE CHARACTER OUT. Each pass replaces one character with one ASCII
--     letter, so `length(fold(x)) = length(normalize(x, NFC))`, which is what lets the excerpt
--     find an offset in the folded text and cut the window out of the original.
--   - The letters are mapped BEFORE `lower()`, for the same collation reason: `lower()` on a
--     non-ASCII character depends on the database's collation and PGlite's is not the
--     server's. Only A-Z is left for it, which every locale agrees about.
--   - The passes cannot interfere. Every replacement is a lowercase ASCII letter and no class
--     holds one, so a later pass never sees an earlier pass's output as input.
--
-- HOW TO EDIT A CLASS, if the mapping must ever change -- which is itself a reindex, and a new
-- ADR. Every class is a plain list of letters. It holds NO range, and none of `^`, `]`, `-` or
-- `\`: inside a bracket expression each of those means something else, and the class would
-- silently match a different set.
--
-- WHY `OFFSET 0`. Writing the fold once in a subquery is not enough to run it once. The planner
-- pulls a simple subquery -- a LATERAL one included -- up into its parent and substitutes the
-- subquery's expression at EVERY reference to its column. So `(SELECT raw.fold(x) AS f) f` with
-- `f.f` used twice folds twice, and in an excerpt that read the folded column inside the
-- per-term aggregate, the fold ran again for every term. A subquery with `OFFSET` is never
-- pulled up -- the documented way to fence one -- so its expression is evaluated once and the
-- parent reads the result. Without the fence these bodies would read as folding once and not
-- do it, which is exactly what the first version of this file did.
--
-- THE EXCERPT. It folds `src` -- the NFC original -- rather than the raw body. That is the same
-- answer, because `raw.fold` normalizes to NFC first and `normalize` is idempotent:
-- `fold(normalize(x, NFC)) = fold(x)`. Its other promises are 190's: the window is cut from the
-- original; a term the text does not hold is ignored rather than counted as offset 0; and when
-- no term appears literally the answer is the head of the text, not a guessed offset.
--
-- THE VECTORS, AND THE INDEXES DECLARED ON THEM. With a FROM clause, `raw.search_tsv` and
-- `raw.record_tsv` cannot be inlined by the planner; they stay calls. 190's bodies were not
-- inlined either -- with them, the plan's index condition already reads `raw.search_tsv(text)`
-- -- so nothing about how the planner sees the index changes. It still matches: the planner
-- reads an index's expression and a query's `@@` operand through the same preprocessing, so
-- `raw.search_tsv(text)` on the index and in the statement are the same call. That is a claim,
-- and the gate is what proves it: "the indexes are live" in `rawSearch.test.ts` (both indexes,
-- one on a partition made after the migration ran) and the tests that the candidate lookups
-- reach the index as a tenant's login. `raw.record_tsv` keeps 190's CASE
-- exactly: a payload over the cap falls back to `raw.search_tsv` over its text, and is never
-- folded and re-read as jsonb, which 190 never did for it either.
--
-- GRANTS. None. `CREATE OR REPLACE` keeps a function's owner and its ACL, so the grants 190
-- wrote and `repeatable/010_provision_tenant.sql` restates still name these four signatures,
-- which are unchanged, as are their attributes.
--
-- WHY A NUMBERED FILE AND NOT `repeatable/`. A repeatable file is a definition meant to be
-- edited in place (ADR 0036). These functions must never be: any change to what they answer is
-- a reindex, and has to arrive as a deliberate migration that says so.

CREATE OR REPLACE FUNCTION raw.fold(t text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT lower(
        regexp_replace(regexp_replace(regexp_replace(
        regexp_replace(regexp_replace(regexp_replace(
        regexp_replace(regexp_replace(regexp_replace(
            normalize(t, NFC),
            -- Vietnamese a (17 lowercase, 17 uppercase), then the Latin-1 ä å Ä Å
            '[àáảãạăằắẳẵặâầấẩẫậÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬäåÄÅ]', 'a', 'g'),
            '[èéẻẽẹêềếểễệÈÉẺẼẸÊỀẾỂỄỆëË]', 'e', 'g'),
            '[ìíỉĩịÌÍỈĨỊïîÏÎ]', 'i', 'g'),
            '[òóỏõọôồốổỗộơờớởỡợÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢöÖ]', 'o', 'g'),
            '[ùúủũụưừứửữựÙÚỦŨỤƯỪỨỬỮỰüûÜÛ]', 'u', 'g'),
            '[ỳýỷỹỵỲÝỶỸỴÿŸ]', 'y', 'g'),
            '[đĐ]', 'd', 'g'),
            '[ñÑ]', 'n', 'g'),
            '[çÇ]', 'c', 'g'))
$$;

CREATE OR REPLACE FUNCTION raw.search_tsv(t text) RETURNS tsvector
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT to_tsvector('simple', f.f) || to_tsvector('english', f.f)
    FROM (SELECT raw.fold(left(t, raw.search_cap())) AS f OFFSET 0) f
$$;

-- `p::text` is fenced too: it is read for the length test and again for the fold, or for the
-- fallback. The fold and the jsonb parse sit inside the THEN branch, so an oversized payload
-- never pays for either.
CREATE OR REPLACE FUNCTION raw.record_tsv(p jsonb) RETURNS tsvector
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT CASE
        WHEN length(r.t) <= raw.search_cap() THEN (
            SELECT jsonb_to_tsvector('simple', f.j, '["string","numeric"]')
                || jsonb_to_tsvector('english', f.j, '["string","numeric"]')
            FROM (SELECT raw.fold(r.t)::jsonb AS j OFFSET 0) f
        )
        ELSE raw.search_tsv(r.t)
    END
    FROM (SELECT p::text AS t OFFSET 0) r
$$;

CREATE OR REPLACE FUNCTION raw.search_excerpt(body text, q text, radius integer DEFAULT 90)
    RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT CASE WHEN s.at = 0
                THEN left(b.src, radius * 2)
                ELSE substr(b.src, greatest(s.at - radius, 1), radius * 2)
           END
    FROM (
        SELECT b0.src, raw.fold(b0.src) AS folded
        FROM (SELECT normalize(left(body, raw.search_cap()), NFC) AS src OFFSET 0) b0
        OFFSET 0
    ) b
    CROSS JOIN LATERAL (
        -- `nullif(..., 0)`: a term the text lacks is not a match at offset 0.
        SELECT coalesce(min(nullif(position(term IN b.folded), 0)), 0) AS at
        FROM unnest(regexp_split_to_array(raw.fold(q), '[^[:alnum:]]+')) AS term
        WHERE term <> ''
    ) s
$$;

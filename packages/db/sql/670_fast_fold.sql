-- The fold, spelled for speed: the same output, a fraction of the time. ADR 0154.
--
-- WHY. `lake.search` ran into the worker's 15 s statement timeout in production on an ordinary
-- name, in a tenant of about 250,000 records and 178,000 readable documents. The candidate
-- lookups (530) were not the problem -- on a bench of real Postgres 17 they take about 45 ms
-- together, through the index. The time was all in what runs AFTER them, over the newest
-- matches: ranking (`ts_rank_cd` over a rebuilt `raw.search_tsv` / `raw.record_tsv`) and
-- `raw.search_excerpt`. Both are dominated by `raw.fold`.
--
-- 190 spelled the fold as `lower(translate(normalize(t, NFC), <list>, <list>))`. Postgres's
-- `translate` compares each character of the input against the whole from-list in turn, so it
-- costs O(characters x 150), and an ASCII character -- the majority of any document, Vietnamese
-- included -- walks the full list without matching. On one 200,000-character body: the fold
-- took 93 ms, `raw.search_tsv` 207 ms (it folds twice), and `raw.search_excerpt` 1,078 ms,
-- because it folded the body once in its WHERE and once in its SELECT for every query term.
--
-- WHAT CHANGES.
--
--   1. `raw.fold` is one `regexp_replace` per target letter, each with a bracket class of the
--      letters that become it. A class is matched in one step per input character, so each pass
--      is linear, and nine passes cost less than one `translate` over the list: 20 ms instead
--      of 96 ms on the body above.
--   2. `raw.search_excerpt` folds the body ONCE and finds every term in that one folded copy.
--
-- Measured on that bench (40,000 documents, 150,000 records), the whole search statement went
-- from 4.77 s to 1.25 s.
--
-- THE OUTPUT IS UNCHANGED, AND THAT IS LOAD-BEARING. Both GIN indexes in 190 were built by
-- calling `raw.fold` through `raw.search_tsv` and `raw.record_tsv`. Postgres trusts an
-- IMMUTABLE function to answer the same forever; replace its body with one that answers
-- differently and the indexes are silently stale -- a row found by one spelling and missed by
-- the other, with no error anywhere. So the mapping below is exactly 190's, letter for letter
-- and in both cases, and nothing here needs a reindex. The equivalence was checked on the bench
-- for every code point from 32 to 8,000 (Latin-1, Latin Extended, the combining marks and the
-- whole Vietnamese block U+1E00-1EFF) and over 3,000 documents; `rawSearch.test.ts` pins the
-- mapping itself, every letter written out, and `scripts/fold.test.ts` reads THIS file, the
-- definition that now runs, against the browser's copy.
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
-- THE EXCERPT FOLDS ONCE. It folds `src` -- the NFC original -- rather than the raw body. That
-- is the same answer, because `raw.fold` normalizes to NFC first and `normalize` is idempotent:
-- `fold(normalize(x, NFC)) = fold(x)`. Its other promises are 190's: the window is cut from the
-- original; a term the text does not hold is ignored rather than counted as offset 0; and when
-- no term appears literally the answer is the head of the text, not a guessed offset. Checked
-- on the bench against 190's body for 500 documents and six queries -- bare terms, a quoted
-- phrase, a negation, no match, a query typed with diacritics -- with identical excerpts.
--
-- WHAT DOES NOT CHANGE. `raw.search_tsv` and `raw.record_tsv` -- the functions the indexes are
-- declared on -- keep their bodies. Folding once inside them was measured and bought nothing
-- (69 ms against 72 ms), and it is not worth touching the two functions an index matches by
-- expression for no gain.
--
-- GRANTS. None. `CREATE OR REPLACE` keeps a function's owner and its ACL, so the grants 190
-- wrote and `repeatable/010_provision_tenant.sql` restates still name these two signatures,
-- which are unchanged.
--
-- WHY A NUMBERED FILE AND NOT `repeatable/`. A repeatable file is a definition meant to be
-- edited in place (ADR 0036). This function must never be: any change to what it answers is a
-- reindex, and has to arrive as a deliberate migration that says so.

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

CREATE OR REPLACE FUNCTION raw.search_excerpt(body text, q text, radius integer DEFAULT 90)
    RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT CASE WHEN s.at = 0
                THEN left(b.src, radius * 2)
                ELSE substr(b.src, greatest(s.at - radius, 1), radius * 2)
           END
    FROM (SELECT normalize(left(body, raw.search_cap()), NFC) AS src) b0
    CROSS JOIN LATERAL (SELECT b0.src, raw.fold(b0.src) AS folded) b
    CROSS JOIN LATERAL (
        -- `nullif(..., 0)`: a term the text lacks is not a match at offset 0.
        SELECT coalesce(min(nullif(position(term IN b.folded), 0)), 0) AS at
        FROM unnest(regexp_split_to_array(raw.fold(q), '[^[:alnum:]]+')) AS term
        WHERE term <> ''
    ) s
$$;

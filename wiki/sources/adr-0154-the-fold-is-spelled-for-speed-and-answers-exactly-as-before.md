---
title: ADR 0154 The Fold Is Spelled for Speed, and Answers Exactly as Before
type: source
date: 2026-11-06
tags: []
source: docs/adr/0154-the-fold-is-spelled-for-speed.md
source_path: docs/adr/0154-the-fold-is-spelled-for-speed.md
source_hash: 7de1733dbe6976cbcb1573dc8125a2ab2ff0671a4172c9077d4f8951a0ab77f5
ingested: 2026-11-06
---

# ADR 0154 The Fold Is Spelled for Speed, and Answers Exactly as Before

Amends [[ADR 0026: Full-text search over the raw lake]] (how `raw.fold` is spelled) and [[ADR 0123 A Search Ranks Each Kind's Newest Matches, Found Through the Index by the Owner]] (its timings, which were PGlite-only); the mapping, length preservation, indexes and caps are unchanged. `lake.search` still hit the worker's 15 s statement timeout in production (three times in seven days). Measured read-only on production (191,250 documents, 246,221 records, Postgres 17.11), `DO HOAI THUONG` matched 10 records and 531 documents; the candidate lookups took 8 + 11 ms, the whole statement 17.07 s: ranking the 100 newest documents \~10 s and the 21-row page's excerpts \~6.4-7.25 s, both dominated by `raw.fold`. 190's `translate` compares every input character against a \~150-letter list, and 190 folded the same text more than once (twice per vector, twice per query term in the excerpt). A plain subquery does not fold once: the planner pulls it up and substitutes the expression at every reference; an earlier "folding once gains nothing" measurement was wrong for that reason.

Decision. `670_fast_fold.sql` replaces `raw.fold` with nine `regexp_replace` passes, one bracket class per target letter (a, e, i, o, u, y, d, n, c), mapping exactly 190's letters in both cases before `lower()`; on production folding the 100 documents went 4.17 → 1.04 s, ranking 9.97 → 3.62 s, excerpts \~6.4 → \~0.2 s. `raw.search_tsv`, `raw.record_tsv` and `raw.search_excerpt` each fold exactly once behind an `OFFSET 0` fence (bench: tsv 70 → 47 ms, excerpt 99 → 29 ms); `raw.record_tsv` keeps 190's CASE and never folds or parses an over-cap payload as jsonb. Every function answers byte for byte as 190's did, so no reindex; the vector functions stay calls (190's were not inlined either), and the "indexes are live" and candidate-lookup tests prove the indexes still match. Grants unchanged. Classes hold no range and none of `^`, `]`, `-`, `\`. `rawSearch.test.ts` pins the mapping letter by letter; `scripts/fold.test.ts` reads the last migration defining `raw.fold`.

Rejected: `unaccent` (not in PGlite, reindex), NFD and strip marks (changes length, misses đ, reindex), a stored tsvector (table rewrite; kept as the option if the worst case proves too slow), lowering the caps, folding once with a plain subquery (pulled up, folds again), restating in `repeatable/` ([[ADR 0036 — A definition is restated, not migrated]]). Consequences: worst case of 100 documents at the 200k cap is \~20 s on production with the new fold alone and \~13 s with fold-once, before excerpts, tight under 15 s, so a follow-up may be needed; GIN maintenance on ingest is cheaper; the English stop word `do` dropped by `raw.search_query` widens `DO HOAI THUONG` to `hoai & thuong`, a separate relevance follow-up.

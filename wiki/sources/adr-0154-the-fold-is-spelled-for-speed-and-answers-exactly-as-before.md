---
title: ADR 0154 The Fold Is Spelled for Speed, and Answers Exactly as Before
type: source
date: 2026-11-06
tags: []
source: docs/adr/0154-the-fold-is-spelled-for-speed.md
source_path: docs/adr/0154-the-fold-is-spelled-for-speed.md
source_hash: 0e88f55d93fb254169c6960127f6735bd78a343ba94e0c073af6736956698f27
ingested: 2026-11-06
---

# ADR 0154 The Fold Is Spelled for Speed, and Answers Exactly as Before

Amends [[ADR 0026: Full-text search over the raw lake]] (how `raw.fold` is spelled) and [[ADR 0123 A Search Ranks Each Kind's Newest Matches, Found Through the Index by the Owner]] (its timings, which were PGlite-only); the mapping, length preservation, indexes and caps are unchanged. `lake.search` still hit the worker's 15 s statement timeout in production (three times in seven days, a tenant of \~250k records and \~178k readable documents). On real Postgres 17 with a 1 GB limit over 40k documents and 150k records, the candidate lookups took \~45 ms; the time was ranking (rebuilding each match's folded vector) and `raw.search_excerpt`, both dominated by `raw.fold`. 190's `translate` compares every input character against a \~150-letter list, O(characters × list), so ASCII walks the whole list. The old excerpt folded the body once per query term, twice.

Decision. `670_fast_fold.sql` replaces `raw.fold` with nine `regexp_replace` passes, one bracket class per target letter (a, e, i, o, u, y, d, n, c), mapping exactly 190's letters in both cases before `lower()`: output identical, one character in and one out, so the GIN indexes built with the old body stay valid and nothing is reindexed. Classes hold no range and none of `^`, `]`, `-`, `\`. `raw.search_excerpt` folds the NFC original once (`fold(normalize(x)) = fold(x)`) and ignores a term the text lacks. `raw.search_tsv`, `raw.record_tsv` and the indexes are untouched; grants unchanged (`CREATE OR REPLACE` keeps owner and ACL). Measured: fold of a 200k-character body 96 → 20 ms, `raw.search_tsv` 207 → 72 ms, whole statement 4.77 s → 1.25 s. `rawSearch.test.ts` pins the mapping letter by letter; `scripts/fold.test.ts` now reads the last migration defining `raw.fold`.

Rejected: `unaccent` (not in PGlite, changes output, reindex), NFD and strip marks (changes length, misses đ, reindex), a stored tsvector (table rewrite, unnecessary now), lowering the caps (smaller answers, same cost), folding once inside the vector functions (69 vs 72 ms, and they are what the indexes match), restating the fold in `repeatable/` (a changed answer is a reindex and must be a deliberate migration, [[ADR 0036 — A definition is restated, not migrated]]). Consequences: 100 full-size documents rank in \~7 s plus excerpts, under the timeout on the bench CPU; GIN maintenance on every ingest is cheaper; the English stop word `do` dropped by `raw.search_query` widens `DO HOAI THUONG` to `hoai & thuong`, a separate relevance follow-up.

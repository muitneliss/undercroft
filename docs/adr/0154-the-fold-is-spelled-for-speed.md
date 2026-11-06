# 154. The fold is spelled for speed, and answers exactly as before

- Status: Accepted
- Date: 2026-11-06
- Amends: [ADR 0026](0026-full-text-search-over-the-raw-lake.md), which spelled `raw.fold` with
  `translate`. The mapping, the length preservation and the indexes are unchanged.
- Amends: [ADR 0123](0123-search-ranks-the-newest-matches-found-through-the-index.md), whose
  timings were measured in PGlite only. The caps it set are unchanged.

## Context

`lake.search` still ran into the worker's 15 s statement timeout in production. One trace
(`ecd525122aca29028589585adafa47d1`) searched for a person's name, `DO HOAI THUONG`, in a
tenant of about 250,000 records and 178,000 readable documents. There were three timeouts in
seven days.

ADR 0123 had made the matching go through the GIN index, and that part held. The problem was
reproduced on real Postgres 17-alpine with a 1 GB memory limit, as production runs it, over a
synthetic Vietnamese corpus of 40,000 documents and 150,000 records:

| What was timed                                 | With 190's fold |              After this ADR |
| ---------------------------------------------- | --------------: | --------------------------: |
| The two candidate lookups (530), together      |          ~45 ms |                      ~45 ms |
| The whole search statement                     |          4.77 s |                      1.25 s |
| Records only                                   |          1.84 s |                      0.56 s |
| Documents only                                 |          5.35 s |                      0.89 s |
| `raw.fold` of one 200,000-character body       |           96 ms |                       20 ms |
| `raw.search_tsv` of that body (it folds twice) |          207 ms |                       72 ms |
| `raw.search_excerpt(body, 'DO HOAI THUONG')`   |        1,078 ms | folds once; not timed alone |

The index was not the problem: the candidate lookups take 45 ms. The time was in what runs over
the newest matches afterwards: ranking, which rebuilds each match's folded vector for
`ts_rank_cd`, and the excerpt. Both are dominated by `raw.fold`.

190 spelled the fold as `lower(translate(normalize(t, NFC), <list>, <list>))`, with about 150
letters in the list. Postgres's `translate` compares each input character against the whole
from-list in turn, so its cost is O(characters × 150). An ASCII character, which is most of any
document, Vietnamese included, walks the full list and matches nothing.

The excerpt made it worse. 190's `raw.search_excerpt` folded the body once in its `WHERE` and
once in its `SELECT` for every query term: one fold plus two per term.

## Decision

**1. `raw.fold` is one `regexp_replace` per target letter.** Nine passes, each a bracket class
of the letters that become one ASCII letter (`a`, `e`, `i`, `o`, `u`, `y`, `d`, `n`, `c`). A
class is matched in one step per input character, so each pass is linear, and the nine together
cost a fifth of the one `translate`.

**2. The output is unchanged, letter for letter.** The classes hold exactly 190's mapping: the
Vietnamese vowels and `đ` in both cases, and the Latin-1 `äëïöüÿñçåîû` / `ÄËÏÖÜŸÑÇÅÎÛ`. The
letters are mapped before `lower()`, for the collation reason ADR 0026 gives. One character in
still makes one character out. This is load-bearing. The GIN indexes were built with the old
body, and Postgres trusts an `IMMUTABLE` function never to change its answer. A respelling that
answered differently would leave both indexes silently stale. The two spellings were compared on
the bench for every code point from 32 to 8,000 and over 3,000 documents, and once more in
PGlite over the same code points, as a one-off check while making this change.
`rawSearch.test.ts` pins the mapping that stays, every letter written out.

**3. The excerpt folds the body once.** It folds the NFC original it cuts from and finds every
term in that one folded copy. That gives the same offsets, because `raw.fold` normalizes first
and `normalize` is idempotent: `fold(normalize(x, NFC)) = fold(x)`. A term the text lacks is
still ignored rather than placed at offset 0. On the bench its excerpts matched 190's for 500
documents and six queries: bare terms, a quoted phrase, a negation, no match, and a query typed
with diacritics.

**4. Nothing else changes, so nothing is reindexed.** `raw.search_tsv` and `raw.record_tsv`,
the functions the indexes are declared on, keep their bodies and so do the indexes. The
signatures, attributes and grants of both replaced functions are unchanged, and `CREATE OR
REPLACE` keeps a function's owner and ACL. The change is one migration,
`670_fast_fold.sql`.

## Options rejected

- **The `unaccent` extension.** PGlite does not ship it, which is why ADR 0026 refused it, and
  its output differs from the current fold, so every index would have to be rebuilt.
- **NFD and strip the combining marks.** It changes the string's length, which breaks the
  excerpt's offsets; it leaves `đ` alone, because `đ` is a letter and not a `d` with a mark; and
  its output differs, so it means a reindex.
- **A stored tsvector column.** Ranking would read a vector instead of rebuilding one. It is a
  rewrite of the partitioned `raw.records`, which ADR 0026 and ADR 0123 refused for that reason,
  and after this change it is not needed.
- **Lowering the caps in ADR 0123.** Each search would rank fewer matches for the same cost per
  match. That treats the symptom and makes every answer smaller.
- **Folding once inside `raw.search_tsv` and `raw.record_tsv`.** Measured: 69 ms against 72 ms,
  no real gain. Those are the functions the indexes match by expression, and they are not worth
  touching for nothing.
- **Restating the fold in `repeatable/`.** A repeatable file is a definition meant to be edited
  in place (ADR 0036). Any change to what this function answers is a reindex, so a change to it
  has to arrive as a numbered migration that says so.

## Consequences

- The worst case is a lake made entirely of full-size documents. Ranking 100 of them takes
  about 7 s, plus the page's excerpts. That is under the 15 s timeout on the bench's CPU, and
  production's CPU may be slower. Past the budget, ADR 0123's timeout refusal still says what
  happened.
- Every ingest gets cheaper too. The index expressions call `raw.fold`, so maintaining the GIN
  indexes on each landed record and document now costs less.
- How to edit the classes is written in `670_fast_fold.sql`. Each class holds plain letters
  only: no range, and none of `^`, `]`, `-` or `\`, which mean something else inside a bracket
  expression. A changed mapping is a reindex and needs its own ADR.
- `scripts/fold.test.ts`, which compares the database's fold with the browser's, now reads the
  last migration that defines `raw.fold` rather than 190 by name.
- A separate relevance issue remains, and it is not addressed here. `raw.search_query` ORs a
  `simple` query with an `english` one. The English half drops `do` as a stop word, so
  `DO HOAI THUONG` also matches any text holding `hoai` and `thuong`, which widens the
  candidates. That is a follow-up about relevance, not about speed.

# 154. The fold is spelled for speed, and answers exactly as before

- Status: Accepted
- Date: 2026-11-06
- Amends: [ADR 0026](0026-full-text-search-over-the-raw-lake.md), which spelled `raw.fold` with
  `translate`. The mapping, the length preservation and the indexes are unchanged.
- Amends: [ADR 0123](0123-search-ranks-the-newest-matches-found-through-the-index.md), whose
  timings were measured in PGlite only. The caps it set are unchanged.

## Context

`lake.search` still ran into the worker's 15 s statement timeout in production. One trace
(`ecd525122aca29028589585adafa47d1`) searched for a person's full name: three syllables, typed
without diacritics, the first being the surname `do`. There were three timeouts in seven days.

ADR 0123 had made the matching go through the GIN index, and that part held. The search was
measured read-only on production, in the tenant it timed out for: 191,250 documents averaging
6,459 characters (p99 65,839; 433 at the 200,000-character cap) and 246,221 records, on Postgres
17.11 with `shared_buffers` 128 MB and `work_mem` 4 MB, on an 8-core VPS. That name
matched 10 records and 531 documents.

| What was timed on production                      | With 190's fold |  With the new fold |
| ------------------------------------------------- | --------------: | -----------------: |
| The candidate lookups (530), records + documents  |    8 ms + 11 ms |          unchanged |
| The whole search statement                        |         17.07 s | not measured whole |
| Folding the 100 newest documents (avg 36,037 ch.) |          4.17 s |             1.04 s |
| Ranking those 100 documents                       |    9.6 - 10.0 s |             3.62 s |
| Excerpts for the 21-row page                      |   ~6.4 - 7.25 s |             ~0.2 s |

The new fold's rows were measured with its expression inlined in the statement, giving the same
`ts_rank_cd` sum and the same total excerpt length. A bench on real Postgres 17 reproduced the
shape: the lookups took about 45 ms and the whole statement 4.77 s, falling to 1.25 s with the new
fold. Production's CPU is about three times slower per character than the bench's.

The index was not the problem: the candidate lookups take milliseconds. The time was in what
runs over the newest matches afterwards. Ranking rebuilds each match's folded vector for
`ts_rank_cd`, and then the page's excerpts are cut. Both are dominated by `raw.fold`.

Two things made the fold slow:

- **`translate` is O(characters × list).** 190 spelled the fold as
  `lower(translate(normalize(t, NFC), <list>, <list>))`, with about 150 letters in the list.
  Postgres's `translate` compares each input character against the whole from-list in turn. An
  ASCII character, which is most of any document, Vietnamese included, walks the full list and
  matches nothing.
- **The same text was folded more than once.** `raw.search_tsv` and `raw.record_tsv` folded
  their text twice, once per text-search configuration. 190's `raw.search_excerpt` folded the
  body twice for every query term.

Writing the fold once in a subquery does not fix the second point by itself. The planner pulls
a simple subquery, a LATERAL one included, up into its parent and substitutes its expression at
every reference to its column. The first version of this change did exactly that: its excerpt
read the folded column inside the per-term aggregate, so the fold still ran once per term. On
the bench, with one 200,000-character body, that excerpt took 99 ms. Fenced so that it folds
once, it took 29 ms. `raw.search_tsv` took 70 ms, and fenced to fold once it took 47 ms. Both had
an identical md5. An earlier measurement had found no gain in folding once inside the vectors.
It was wrong for this reason: it measured a body that only looked as if it folded once.

## Decision

**1. `raw.fold` is one `regexp_replace` per target letter.** Nine passes, each a bracket class
of the letters that become one ASCII letter (`a`, `e`, `i`, `o`, `u`, `y`, `d`, `n`, `c`). A
class is matched in one step per input character, so each pass is linear. On production the
nine together folded the 100 documents in a quarter of the time `translate` took.

**2. The output is unchanged, letter for letter.** The classes hold exactly 190's mapping: the
Vietnamese vowels and `đ` in both cases, and the Latin-1 `äëïöüÿñçåîû` / `ÄËÏÖÜŸÑÇÅÎÛ`. The
letters are mapped before `lower()`, for the collation reason ADR 0026 gives. One character in
still makes one character out.

This is load-bearing. The GIN indexes were built with the old body, and Postgres trusts an
`IMMUTABLE` function never to change its answer. A respelling that answered differently would
leave both indexes silently stale. The two spellings were compared in three places:

- on the bench, for every code point from 32 to 8,000 and over 3,000 documents;
- once more in PGlite over the same code points, as a one-off check while making this change;
- in `rawSearch.test.ts`, which pins the mapping that stays, every letter written out.

**3. Every function that folds a text folds it exactly once, behind `OFFSET 0`.** A subquery
with `OFFSET` is never pulled up. It is the documented way to fence one, so its expression is
evaluated once and the parent reads the result.

- `raw.search_tsv` folds its text once and builds both configurations' vectors from it.
- `raw.record_tsv` reads the payload's text once. Within the cap, it folds that text once and
  parses it as jsonb once. Over the cap it falls back to `raw.search_tsv`, exactly as 190's
  CASE did, and never folds or parses the oversized text as jsonb.
- `raw.search_excerpt` folds the NFC original it cuts from, once, and finds every term in that
  one copy. That gives the same offsets, because `raw.fold` normalizes first and `normalize` is
  idempotent: `fold(normalize(x, NFC)) = fold(x)`. A term the text lacks is still ignored rather
  than placed at offset 0.

Every one of them answers byte for byte what 190's did. On the bench, the excerpts matched 190's
for 500 documents and six queries: bare terms, a quoted phrase, a negation, no match, and a
query typed with diacritics.

**4. Nothing is reindexed.** The indexes are declared on `raw.search_tsv(text)` and
`raw.record_tsv(payload)`. Both keep their signatures and their output. With a `FROM` clause
they cannot be inlined, so they stay calls. 190's bodies were not inlined either: their plan's
index condition already reads `raw.search_tsv(text)`. The planner reads an index's expression
and a query's `@@` operand through the same preprocessing, so they still match. The gate is what
proves it: the tests that the indexes are live, one of them on a partition made after the
migration ran, and the tests that the candidate lookups reach the index as a tenant's login.

The signatures, attributes and grants of all four replaced functions are unchanged, and
`CREATE OR REPLACE` keeps a function's owner and ACL. The change is one migration,
`670_fast_fold.sql`.

## Options rejected

- **The `unaccent` extension.** PGlite does not ship it, which is why ADR 0026 refused it, and
  its output differs from the current fold, so every index would have to be rebuilt.
- **NFD and strip the combining marks.** It changes the string's length, which breaks the
  excerpt's offsets; it leaves `đ` alone, because `đ` is a letter and not a `d` with a mark; and
  its output differs, so it means a reindex.
- **A stored tsvector column.** Ranking would read a vector instead of rebuilding one. It is a
  rewrite of the partitioned `raw.records`, which ADR 0026 and ADR 0123 refused for that reason.
  It stays the option if the worst case below proves too slow.
- **Lowering the caps in ADR 0123.** Each search would rank fewer matches for the same cost per
  match. That treats the symptom and makes every answer smaller.
- **Folding once by writing a plain subquery.** It reads as folding once and does not. The
  planner pulls it up and folds again at every reference. Hence the fence.
- **Restating the functions in `repeatable/`.** A repeatable file is a definition meant to be
  edited in place (ADR 0036). Any change to what these functions answer is a reindex, so it has
  to arrive as a numbered migration that says so.

## Consequences

- **The worst case is still tight.** It is a lake whose 100 newest matches are all at the
  200,000-character cap. On production's CPU, ranking those would take about 20 s with the new
  fold alone. Folding once inside the vectors brings it to about 13 s, before the page's
  excerpts. That is under the 15 s timeout with little room. Past the budget, ADR 0123's timeout
  refusal still says what happened. If such lakes appear, a follow-up is needed: a stored
  vector, or a cap counted in characters rather than documents.
- **Every ingest gets cheaper too.** The index expressions call `raw.search_tsv` and
  `raw.record_tsv`, so maintaining the GIN indexes on each landed record and document now
  folds once, with the faster fold.
- **How to edit a class is written in `670_fast_fold.sql`.** Each class holds plain letters
  only: no range, and none of `^`, `]`, `-` or `\`, which mean something else inside a bracket
  expression. A changed mapping is a reindex and needs its own ADR.
- **`scripts/fold.test.ts` reads the last migration that defines `raw.fold`.** That test
  compares the database's fold with the browser's, and before this change it read 190 by name.
- **A separate relevance issue remains, and it is not addressed here.** `raw.search_query` ORs
  a `simple` query with an `english` one. The English half drops `do` as a stop word, so
  a name beginning with the surname `do` also matches any text holding its other two
  syllables, which widens the candidates. That is a follow-up about relevance, not about speed.

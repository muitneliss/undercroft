# 155. A search ranks through a BM25 index per tenant, behind a door

- Status: Accepted
- Date: 2026-11-06 (proposed and accepted the same day; decision 5 settled on acceptance)
- Amends: [ADR 0123](0123-search-ranks-the-newest-matches-found-through-the-index.md). A
  document search ranks through a BM25 index instead of a rebuilt vector, and the cap of the
  newest 100 documents goes. [ADR 0026](0026-full-text-search-over-the-raw-lake.md)'s fold, its
  length-preserving excerpt, its GIN indexes and the tenant login stay.
- Evidence: a one-day spike against pg_textsearch v1.5.1 on synthetic data shaped like
  production. Its report and scripts are outside the repository, because they are throwaway. The
  numbers that matter are quoted here.

## Context

[ADR 0154](0154-the-fold-is-spelled-for-speed.md) made the search that timed out in production
finish in about 2.5 s instead of 17 s. It made each step cheaper, but it left the shape unchanged:
to rank a hit, the search still rebuilds that row's text-search vector from its full text. That
is why a search ranks only the newest 100 documents. It is also why its cost follows the size of
the newest matches, not the size of the page.

The spike measured what that shape costs once the newest matches are large. On a bench of real
Postgres 17 with production's 1 GB limit, the data was 191,200 documents (p50 2,032 / p90 12,871 /
p99 57,831 characters) and 246,200 records. 120 freshly landed documents of 200,000 characters
each were enough. Every query then took **5.25-5.58 s** after 0154, because the newest 100
matches of almost any word were those documents. Production's CPU measured about 3x slower per
character than the bench (ADR 0154), which puts that at about 16 s, past the 15 s timeout again.
A sync of large PDFs is an ordinary event.

[pg_textsearch](https://github.com/timescale/pg_textsearch) (Timescale, PostgreSQL License) keeps
BM25 statistics in its index and ranks from them, using Block-Max WAND for the top k, without
reading the row's text. It ships a PGlite build, `@electric-sql/pglite-pg_textsearch`, so the
offline gate can prove it. That is the reason this ADR does not take ParadeDB's `pg_search`:
AGPL-3.0, no Alpine build, and not in PGlite, so a design built on it would be proven nowhere
before production (the argument ADR 0026 made against `unaccent`).

## What the spike found

|                               | Result                                                                                                                                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build on `postgres:17-alpine` | PGXS, multi-stage, no patch; the image grows 416 → 419 MB. Needs `shared_preload_libraries`.                                                                                                                                                                        |
| PGlite                        | Byte-identical scores on a fixture (24/24 rows), server PG 17 against PGlite PG 18.6. The package pins `@electric-sql/pglite` at exactly 0.5.15 (the repo is on 0.5.13).                                                                                            |
| Tenant login under RLS        | The tenant's own dbt login uses the BM25 index for `ORDER BY … <@> … LIMIT`, and the policy is applied as a filter: 7-8 ms. Unlike `@@` (ADR 0123), the ordering operator is not blocked.                                                                           |
| **Isolation**                 | **A shared index leaks** (below). A per-tenant partial index separates the statistics completely: 0 of 300 scores moved when another tenant's data changed.                                                                                                         |
| Vietnamese                    | With the fold as the index expression and `text_config='simple'`, BM25 missed none of today's matches for 8 queries: names with and without diacritics, common syllables, English, a quoted phrase. `simple` does not stem: `contract` no longer finds `contracts`. |
| Records                       | An IMMUTABLE function of a payload's string and numeric values yields exactly the lexemes `jsonb_to_tsvector(... '["string","numeric"]')` does (5,000 records). Ranking records with BM25 was **not** measured.                                                     |
| Speed                         | Page of 21 hits with excerpts: p50 377-441 ms, p95 ≤ 585 ms. Ranking alone: 10-12 ms. Worst case (a word only 200k-character documents hold): 1.65 s, or 2.61 s with every term required. Peak memory 409 MiB with `pg_textsearch.memory_limit = 256MB`.            |
| Ingest                        | About +1.1 ms per document, close to what the GIN index costs.                                                                                                                                                                                                      |
| Updates                       | Rewriting 10% of a tenant's documents grew its index 216 → 362 MB. `VACUUM` does not shrink it; `REINDEX` does.                                                                                                                                                     |

### The leak

BM25 scores carry corpus statistics: how many documents hold a term, and how long they are. In a
shared index those statistics are every tenant's. That is a side channel in itself, and the spike
measured it: all 277 of one tenant's scores moved when another tenant added documents.

The worse finding needs no shared index. `to_bm25query(text, index_name)` accepts **any** index
name, and scoring needs no access to that index's rows. One tenant's dbt login wrote a table in its
own analytics schema, which is exactly what a dbt model does. It then scored that table's text
against the **other** tenant's index:

- a word the other tenant holds scored −2.17;
- a word it does not hold scored 0.

That is a membership oracle over another customer's documents ("does anyone there mention this
name?"). Row-level security does not stop it, because no row of the other tenant is read.

## Decision

1. **Two partial BM25 indexes per tenant**, one with `text_config='simple'` and one with
   `text_config='english'` (decision 5). Both cover `raw.document_text` on
   `raw.fold(left(text, raw.search_cap()))`, `WHERE tenant_id = '<tenant>'`.
   - It is created by `ops.provision_tenant` in `repeatable/010_provision_tenant.sql`, the one
     place a tenant's objects are stated (`privileges.md`, ADR 0036).
   - It is built with `SET LOCAL max_parallel_maintenance_workers = 0`. The parallel build of a
     partial expression index evaluates the expression for every heap row: 96 ms serially against
     111 s with one worker, for a 200-document tenant
     ([timescale/pg_textsearch#593](https://github.com/timescale/pg_textsearch/issues/593)).
   - Fifty tenants cost about 1 MB per small index and 2.4 ms of planning (one index each; the
     spike did not measure two).
2. **No tenant login can reach the extension.**
   - It is created in a schema of its own, with no `USAGE` for any tenant login, BI login or scope
     login.
   - No dbt model can then call `to_bm25query` or `<@>`, so no tenant can name another tenant's
     index. This was verified: the probe above fails with "permission denied for schema".
3. **Search goes through a `SECURITY DEFINER` door**, ADR 0123's pattern, for statistics rather
   than for leakproofness. `raw.search_document_bm25(p_role, q, n)`:
   - derives both index names from `raw.tenant_of(p_role)`, so a caller can only ever rank against
     its own statistics;
   - **returns keys in order, never a score per row.** Putting `<@>` in the select list re-scores
     the row from its text, about 2.3 ms a row: 10,000 rows took 23.4 s against 46 ms unprojected.
     A score, if the answer shows one, is computed for the page alone;
   - **drops rows that did not match.** BM25 orders and does not filter. Matches always come
     first (55,196 of 55,196 in the spike), but past them a large `LIMIT` returns zero-score rows;
   - **keeps today's query language.** BM25 ranks any term, while today a search requires every
     term, honours `"phrases"` and `-negation`. The door filters with
     `raw.search_tsv(text) @@ raw.search_query(q)` on the rows the BM25 scan yields, which cost
     about 400 ms (2.6 s in the worst case). Filtering through the GIN candidates instead was
     planned as join-then-score (3.6 s for 120 large documents) and would need the index-ordered
     plan forced;
   - takes the query as a constant. A query read from a column loses the index ordering, and every
     row is then scored one by one.
4. **The cap of the newest 100 goes.** BM25 ranks every match of the tenant, so
   `RawSearchResponse.capped` no longer describes a cut on the document side. Changing that
   contract (removing the kind, or keeping it for records until decision 6) is part of this change
   and is user-visible in the Lake screen and the skill.
5. **English stemming is kept, through a second index.** A `simple` index alone would lose
   `contract` → `contracts`, and with it the "one search box for both languages" promise of
   ADR 0026. So each tenant has a `simple` index (Vietnamese, exact syllables) and an `english`
   index (stems), and the door combines them:
   - **by rank, not by score.** Each index yields its keys in BM25 order. The door fuses the two
     orders with reciprocal rank fusion (each key scores `1 / (60 + rank)` in each list it appears
     in, summed). Adding the two BM25 scores would need a score per row, which decision 3 forbids,
     and the two scores are on different scales anyway;
   - over a bounded head of each list, deep enough for the page asked for. The depth is a budget
     the implementation measures and states, the way `RANKED_PER_KIND` is stated today;
   - with the filter of decision 3 applied to the fused result, so the semantics stay today's.

   The cost: twice the BM25 index size and build time, and two index scans per search. The spike
   measured one index; the implementation measures both, and the fusion, before release.

   The GIN indexes stay, for the filter of decision 3 and for `raw.records`.

6. **Records stay on ADR 0123's ranking** until BM25 over `raw.records` is measured. That table is
   partitioned by source, and pg_textsearch keeps statistics per partition. Production holds every
   record in one partition today, so the skew does not arise yet; it would with the first
   per-source partition (see timescale/pg_textsearch#552).

## Operations

- **The Postgres image becomes ours:**
  - `postgres:17-alpine` plus pg_textsearch, `shared_preload_libraries=pg_textsearch` and
    `pg_textsearch.memory_limit` sized under the 1 GB limit;
  - one Postgres restart, in a release window, through the Dokploy compose (ADR 0049); no SSH
    write.
- **`CREATE EXTENSION`** in a numbered migration (it needs the bootstrap superuser, which runs
  migrations).
- **The gate** moves to `@electric-sql/pglite` 0.5.15 and adds `@electric-sql/pglite-pg_textsearch`.
  The gate then runs Postgres 18 while production runs 17. The fixture agreed byte for byte, but it
  is a divergence to watch.
- **A scheduled `REINDEX CONCURRENTLY`** of the per-tenant indexes, because re-extraction grows
  them and `VACUUM` does not give the space back.

## Options rejected

- **A shared BM25 index for all tenants.** It leaks corpus statistics between customers. It was
  measured, and no filter on rows can fix it.
- **Letting the tenant login call the extension directly**, even with per-tenant indexes. Any index
  name is accepted, so any tenant can score text against another tenant's statistics.
- **One `simple` BM25 index and no stemming** (decision 5(b) as proposed). Half the index
  cost, but `contract` would stop finding `contracts`, which a reader of English documents meets
  every day.
- **ParadeDB `pg_search`.** AGPL-3.0, no Alpine build, not in PGlite. It would also need the same
  isolation design, and its behaviour under RLS is undocumented.
- **Keeping ADR 0123's shape and lowering the caps.** That bounds the worst case by ranking fewer
  matches for the same question, which treats the symptom 0154 already narrowed.
- **Storing the tsvector beside each row.** It makes ranking cheap without an extension, but it is
  the table rewrite ADR 0026 refused. It would still re-score with `ts_rank_cd` (no BM25, no top-k
  pruning), and a side table would be a second writer of a projection `LakeStore` does not own.

## Consequences and risks

- **pg_textsearch is young.** It has been GA since v1.0.0 and is at v1.5.1. Its issue tracker
  closed several index-corruption bugs in 2026 (#359, #404, #411, #430, #515) and has a VACUUM
  crash open (#569). The index is a projection, rebuilt from `raw.document_text` by `REINDEX`, so
  rule 1 holds: nothing durable is at risk. But a corrupt index would fail searches until it is
  rebuilt.
- **Two indexes per tenant** multiply BM25 indexes by twice the tenants. One per tenant, measured
  at 50 tenants, was cheap. Neither was measured at 1,000.
- **BM25 has no proximity.** In the spike's fixture, the name with its syllables reversed ranked
  third. Ranking quality beyond "nothing today finds is missed" was not evaluated.
- **Not measured:** BM25 over `raw.records`, production-CPU timings of the BM25 path, a restart,
  backup and restore, and a replica.
- **Implementation** is its own approved plan:
  - the migration and the extension schema;
  - the two per-tenant indexes in `ops.provision_tenant`;
  - the door, its rank fusion and the worker's statement;
  - the `capped` contract;
  - the compose image and its release;
  - the gate's PGlite bump;
  - the reindex schedule.

---
title: ADR 0156 BM25 Search, as Measured Before It Shipped
type: source
date: 2026-11-06
tags: []
source: docs/adr/0156-bm25-search-as-measured-before-it-shipped.md
source_path: docs/adr/0156-bm25-search-as-measured-before-it-shipped.md
source_hash: 34517f7566bfe8b6c8a21ac2bc55112d83f2fe0c9c240df26eb10bb56848b34e
ingested: 2026-11-06
---

# ADR 0156 BM25 Search, as Measured Before It Shipped

Amends [[ADR 0155 A Search Ranks Through a BM25 Index per Tenant, Behind a Door]] decisions 1, 2, 3 and 5 with what a bench of real Postgres 17 (1 GB, 191,200 synthetic documents, one tenant of 172,000) and Docker Compose v5.5.0 measured before the BM25 search shipped, including a second round measuring the door as a tenant's own login. ADR 0155's door and its two indexes per tenant stand; the privilege that keeps a tenant from the extension becomes EXECUTE rather than USAGE.

**The english index is declared on its own wrapper.** Two BM25 indexes on the same expression are ambiguous: the planner picks one and a query naming the other fails ("query specifies index X but planner chose index Y"). The `english` index is on `raw.search_text_english(text)`, whose `SET search_path` clause stops it being inlined back into the simple expression; the `simple` index stays on `raw.fold(left(text, raw.search_cap()))`.

**BM25 ranks the positive terms alone.** Ranked whole, `-xe hop dong` put the documents holding `xe` first, the all-terms filter removed them, and nothing was left. `raw.search_bm25_terms` strips negated words and phrases, quotes and `or`; what a query means is decided by the filter, as before.

**The filter is a semi-join with GIN keys.** Re-testing each ranked row with `@@` rebuilt its vector (2-8 s at depth 3,000); a semi-join with the keys `raw.search_document_matches` finds through the GIN index cost 100-353 ms. That function is 620's candidate lookup without the newest-first sort and the join to `raw.documents`, with all of [[ADR 0123 A Search Ranks Each Kind's Newest Matches, Found Through the Index by the Owner]]'s guarantees.

**Fusion depth 10,000.** Each index is read in BM25 order, keys only (`<@>` in a select list re-scores at about 2.3 ms a row), fused by reciprocal rank fusion `sum(1/(60+rank))`, kept to the matching keys and paged; at depth 10,000 every tested page equalled depth 20,000, in 130-353 ms. `raw.search_bm25_depth()` states it.

**Readiness, and a door that refuses.** `raw.search_document_bm25_ready(p_role)` says whether both indexes are valid and ready; the caller asks it first. The door raises SQLSTATE 55000 when they are not, and when its page is shorter than asked while more documents match -- a short page would read as "no more hits" -- and the caller then ranks ADR 0123's way. The door does not fall back itself, because the caller must know which ordering and cap rule its page followed.

**Builds are serial, and the bloat is accepted.** A `CREATE INDEX CONCURRENTLY` on pg\_textsearch runs with no parallel worker, so the first version's parallel rule was dead code: its builds came out 781 MB and 778 MB, against 214 MB for a non-concurrent parallel build. Every build and reindex is serial (also keeping timescale/pg\_textsearch#593 away), the latency was measured on these bloated indexes, production has about 79 GB free, and a non-concurrent build would hold a SHARE lock on every tenant's extraction. `ops.provision_tenant` builds an empty tenant's indexes only when it can take the SHARE lock at once.

**`search-index` is the bootstrap role's, and long-running.** `GRANT MAINTAIN` allowed `REINDEX CONCURRENTLY` but not `CREATE INDEX`, so both stay with the bootstrap role. A deploy killing a build leaves an invalid index, which the next pass drops and rebuilds, along with a cut-short reindex's `_ccnew` copy. Found while implementing: `docker compose up --wait` fails on a container nothing depends on that has already exited, so a one-shot pass with nothing to do would fail every deploy; the service makes a pass at start and every six hours. An index is reindexed at twice its last built size and 64 MiB larger, sizes kept in `ops.search_index_build`; one pass at a time by an advisory lock.

**The planner hook reads `search_path`, so the tenant login has USAGE and no EXECUTE.** As the tenant's own login the door took 11-42 s: Postgres re-scored each row the index returned (about 1.8 ms a row) because pg\_textsearch's hook, which swaps the ORDER BY score for the cached `bm25_get_current_score()`, resolves the operator and the stub by unqualified name through `search_path`, in effect as the backend's first statement had it -- a role default works, a `SET` in the session does not, and inside the door with `pg_catalog, raw` the stub was not found. So the tenant's dbt login gets USAGE on `search_ext` and a role default path `"$user", public, search_ext`, the door and its head carry `pg_catalog, raw, search_ext`, and EXECUTE on every function in `search_ext` is revoked from PUBLIC (a future `ALTER EXTENSION UPDATE` must repeat it). The oracle probe is refused "permission denied for function"; BI, scope and platform roles have no USAGE. Measured then: 54-101 ms for 21-row pages, 0.8 ms for an absent word. Pinned by enumerating every function in the schema; PGlite runs one backend, so the gate cannot show the hook or the latency. An upstream issue asking pg\_textsearch to resolve these OIDs in its own schema waits on the go-ahead.

Rejected: telling the planner which of two same-expression indexes to use, ranking the whole query, filtering with `@@`, reusing the newest-first candidates, numbering an ordered subquery, a door that falls back by itself, a one-shot or depended-on `search-index`, parallel or non-concurrent builds, keeping "no USAGE for any tenant login", and setting `search_path` per session. With USAGE a tenant can also build a bm25 index on its own table (drawing on the shared memory budget) and resolve an index name through the type's input function; scoring is refused either way. Not measured: a narrowed reader's head cost, production-CPU timings, a reindex on production's CPU, the pass against a thousand tenants. Seen and left unchanged: `raw.search_tsv` concatenates two vectors, so a quoted phrase can match across the seam ([[ADR 0026: Full-text search over the raw lake]]'s behaviour).

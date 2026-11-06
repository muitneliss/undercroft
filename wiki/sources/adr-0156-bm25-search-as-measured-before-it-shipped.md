---
title: ADR 0156 BM25 Search, as Measured Before It Shipped
type: source
date: 2026-11-06
tags: []
source: docs/adr/0156-bm25-search-as-measured-before-it-shipped.md
source_path: docs/adr/0156-bm25-search-as-measured-before-it-shipped.md
source_hash: 925f99f965f032de230fdd9aa7cf75fdd3f2b6a61e8a83b3135b1c6e097d3410
ingested: 2026-11-06
---

# ADR 0156 BM25 Search, as Measured Before It Shipped

Amends [[ADR 0155 A Search Ranks Through a BM25 Index per Tenant, Behind a Door]] decisions 1, 3 and 5 with what a bench of real Postgres 17 (1 GB, 191,200 synthetic documents, one tenant of 172,000) and Docker Compose v5.5.0 measured before the BM25 search shipped. ADR 0155's isolation design, its door and its two indexes per tenant stand.

**The english index is declared on its own wrapper.** Two BM25 indexes on the same expression are ambiguous: the planner picks one and a query naming the other fails ("query specifies index X but planner chose index Y"). The `english` index is on `raw.search_text_english(text)`, whose `SET search_path` clause stops it being inlined back into the simple expression; the `simple` index stays on `raw.fold(left(text, raw.search_cap()))`.

**BM25 ranks the positive terms alone.** Ranked whole, `-xe hop dong` put the documents holding `xe` first, the all-terms filter removed them, and nothing was left. `raw.search_bm25_terms` strips negated words and phrases, quotes and `or`; what a query means is decided by the filter, as before.

**The filter is a semi-join with GIN keys.** Re-testing each ranked row with `@@` rebuilt its vector (2-8 s at depth 3,000); a semi-join with the keys `raw.search_document_matches` finds through the GIN index cost 100-353 ms. That function is 620's candidate lookup without the newest-first sort and the join to `raw.documents`, with all of [[ADR 0123 A Search Ranks Each Kind's Newest Matches, Found Through the Index by the Owner]]'s guarantees.

**Fusion depth 10,000.** Each index is read in BM25 order, keys only (`<@>` in a select list re-scores at about 2.3 ms a row), fused by reciprocal rank fusion `sum(1/(60+rank))`, kept to the matching keys and paged; at depth 10,000 every tested page equalled depth 20,000, in 130-353 ms. `raw.search_bm25_depth()` states it.

**Readiness, and a door that refuses.** `raw.search_document_bm25_ready(p_role)` says whether both indexes are valid and ready; the caller asks it first. The door raises SQLSTATE 55000 when they are not, and when its page is shorter than asked while more documents match -- a short page would read as "no more hits" -- and the caller then ranks ADR 0123's way. The door does not fall back itself, because the caller must know which ordering and cap rule its page followed.

**Builds: parallel for a large tenant.** Serial builds bloated (simple 421 MB, english 778 MB, serial reindex 781 MB, against 214 MB in parallel), but a parallel partial expression build evaluates the expression for every row of the table (timescale/pg\_textsearch#593). A tenant holding at least a quarter of `raw.document_text` builds in parallel, every other serially -- a judgement between the two measurements. `ops.provision_tenant` builds an empty tenant's indexes only when it can take the SHARE lock at once.

**`search-index` is the bootstrap role's, and long-running.** `GRANT MAINTAIN` allowed `REINDEX CONCURRENTLY` but not `CREATE INDEX`, so both stay with the bootstrap role. A deploy killing a build leaves an invalid index, which the next pass drops and rebuilds, along with a cut-short reindex's `_ccnew` copy. Found while implementing: `docker compose up --wait` fails on a container nothing depends on that has already exited, so a one-shot pass with nothing to do would fail every deploy; the service makes a pass at start and every six hours. An index is reindexed at twice its last built size and 64 MiB larger, sizes kept in `ops.search_index_build`; one pass at a time by an advisory lock.

**Isolation, pinned.** pg\_textsearch lives in `search_ext` with USAGE for nobody, named in the explicit refusals for tenant, BI, scope and platform roles; index names come from one hash-based derivation, `raw.search_index_name`, over `raw.tenant_of(p_role)`. The membership-oracle probe answers to a role that can reach the extension and is refused to a tenant's dbt login.

Rejected: telling the planner which of two same-expression indexes to use, ranking the whole query, filtering with `@@`, reusing the newest-first candidates, numbering an ordered subquery, a door that falls back by itself, a one-shot or depended-on `search-index`, and serial builds everywhere. Not measured: a narrowed reader's head cost, the threshold at exactly a quarter, a reindex on production's CPU, the pass against a thousand tenants. Seen and left unchanged: `raw.search_tsv` concatenates two vectors, so a quoted phrase can match across the seam ([[ADR 0026: Full-text search over the raw lake]]'s behaviour).

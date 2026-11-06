---
title: ADR 0155 A Search Ranks Through a BM25 Index per Tenant, Behind a Door
type: source
date: 2026-11-06
tags: []
source: docs/adr/0155-search-ranks-through-a-bm25-index-per-tenant.md
source_path: docs/adr/0155-search-ranks-through-a-bm25-index-per-tenant.md
source_hash: 3bc0febed4f679ea2a89c27e814375f1389bdd12affd9418f3c872a4c8b3b257
ingested: 2026-11-06
---

# ADR 0155 A Search Ranks Through a BM25 Index per Tenant, Behind a Door

Status Proposed. Would amend [[ADR 0123 A Search Ranks Each Kind's Newest Matches, Found Through the Index by the Owner]] (ranking from a BM25 index instead of a rebuilt vector, and no cap of the newest 100 documents); [[ADR 0026: Full-text search over the raw lake]]'s fold, excerpt and tenant login stay. Context: after [[ADR 0154 The Fold Is Spelled for Speed, and Answers Exactly as Before]] a search still rebuilds each ranked row's vector, so on a production-shaped bench (191,200 documents, 246,200 records, 1 GB) 120 fresh 200k-character documents made every query take 5.25-5.58 s, about 16 s on production's CPU. pg\_textsearch v1.5.1 (PostgreSQL License, Block-Max WAND) ranks from its index and has a PGlite build, unlike ParadeDB pg\_search (AGPL, no Alpine, not in PGlite).

Spike findings: builds on postgres:17-alpine (+3 MB, needs shared\_preload\_libraries); PGlite byte-identical but pins @electric-sql/pglite 0.5.15 and runs PG 18; the tenant login uses the index under RLS (7-8 ms); a shared index leaks corpus statistics between tenants, and to\_bm25query accepts any index name, so a tenant's dbt login could score its own text against another tenant's index (present term -2.17, absent 0: a membership oracle); BM25 missed none of today's matches for 8 queries, but 'simple' loses English stemming; page with excerpts p50 377-441 ms, ranking 10-12 ms, worst 1.65 s; ingest +1.1 ms per document; a 10% rewrite grew the index 216 to 362 MB and VACUUM does not shrink it.

Proposed decision: (1) one partial BM25 index per tenant on raw\.fold(left(text, raw\.search\_cap())), created in ops.provision\_tenant and built serially (parallel partial expression builds evaluate every row, timescale/pg\_textsearch#593); (2) the extension in a schema no tenant, BI or scope login can use; (3) a SECURITY DEFINER door raw\.search\_document\_bm25 that derives the index from raw\.tenant\_of, returns keys in order without per-row scores (projecting <@> re-scores from text, \~2.3 ms a row), drops non-matching rows, keeps every-term, phrase and negation semantics with an @@ filter, and takes the query as a constant; (4) the newest-100 cap goes and RawSearchResponse.capped changes; (5) stemming open: a second english index (preferred) or simple only; (6) records stay on ADR 0123 until measured (statistics are per partition). Operations: our own Postgres image and one restart via Dokploy, CREATE EXTENSION in a migration, PGlite bump, scheduled REINDEX CONCURRENTLY. Rejected: shared index, direct extension access, pg\_search, lower caps, stored tsvector. Risks: a young extension with several 2026 corruption bugs (the index is a rebuildable projection), index count grows with tenants, no proximity, records and production-CPU timings unmeasured.

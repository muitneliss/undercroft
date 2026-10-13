---
title: >-
  ADR 0123 A Search Ranks Each Kind's Newest Matches, Found Through the Index by
  the Owner
type: source
date: 2026-10-13
tags: []
source: docs/adr/0123-search-ranks-the-newest-matches-found-through-the-index.md
source_path: docs/adr/0123-search-ranks-the-newest-matches-found-through-the-index.md
source_hash: 5deefc0b3f944d6b0ca15d08ebf18021da8a5c61df3c1bbd404b8cc35517205f
ingested: 2026-10-13
---

# ADR 0123 A Search Ranks Each Kind's Newest Matches, Found Through the Index by the Owner

Amends [[ADR 0026: Full-text search over the raw lake]] in how a search finds and ranks rows and what it answers; the fold, the indexes, the tenant login and the length-preserving excerpt are unchanged. #447: every `lake.search` in an audit ran into the worker's 15 s statement timeout and was refused as "the service did not answer; try again", which sent agents round the same query. Beyond ranking and excerpting every match, the statement never used the GIN indexes as the tenant's dbt login: `@@` (`ts_match_vq`) is not LEAKPROOF, and under a row-level policy Postgres will not make a non-leakproof operator an index condition, so each search rebuilt the folded tsvector of every row the tenant owned. 0026's plan test ran as the superuser and never saw it.

Decision. Two SECURITY DEFINER functions in `530_raw_search_candidates.sql`, `raw.search_record_candidates` and `raw.search_document_candidates`, owned by the bootstrap superuser, find the caller's matches through the index, newest first, at most n, and answer with keys and an ordinal only. The tenant is decided by `raw.tenant_of(p_role)`, which answers only when `session_user` is a member of the role. The body is fixed, its search path pinned, `@@` fenced from the tenant condition with sequential scans off. EXECUTE is granted only to tenant dbt logins in `repeatable/010_provision_tenant.sql`. The search then joins the keys back as the tenant under the policy, ranks at most 2,000 records and 100 documents (`RANKED_PER_KIND`, sized from PGlite measurements of vector rebuild cost per kind), pages, and cuts `raw.search_excerpt` above the page's LIMIT. `RawSearchResponse.capped` names each kind that had more matches and how many were ranked, on every page. A Postgres 57014 naming the statement timeout becomes `QueryTimedOut`, worker `504 query_timeout`, control-plane `timed-out` read from the status, and a `BAD_REQUEST` sentence saying to narrow the search rather than retry it.

Why newest: a set a reader can be told about, likeliest to hold what an operator wants, a total order so paging is stable, and free to compute. Rejected: capping the old statement (a rare word still scanned the lake), running as `undercroft_worker` (isolation by a written `tenant_id`), a leakproof copy of `@@` (a superuser trust claim Postgres does not make), a stored tsvector (table rewrite, or a second writer). Consequences: matches older than a kind's newest n are on no page and the answer says so; a quoted phrase of common words rechecks every row holding all its words; `lake.query` keeps Postgres's own timeout sentence.

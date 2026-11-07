---
title: >-
  ADR 0157 A Search Page Interleaves Its Kinds by Place, and capped Names the
  Older Path
type: source
date: 2026-11-06
tags: []
source: >-
  docs/adr/0157-a-search-page-interleaves-its-kinds-and-capped-names-the-older-path.md
source_path: >-
  docs/adr/0157-a-search-page-interleaves-its-kinds-and-capped-names-the-older-path.md
source_hash: 9e41a5bcbea782922cf31021e8faaf643f31c1bec4e34ba000412ec19adb4472
ingested: 2026-11-06
---

# ADR 0157 A Search Page Interleaves Its Kinds by Place, and capped Names the Older Path

Implements the worker's half of [[ADR 0155 A Search Ranks Through a BM25 Index per Tenant, Behind a Door]] as [[ADR 0156 BM25 Search, as Measured Before It Shipped]] left it, and amends [[ADR 0123 A Search Ranks Each Kind's Newest Matches, Found Through the Index by the Owner]] on how the two kinds share a page and what `rank` is.

**Each kind is ranked within itself, and the page interleaves them by place.** Records by `ts_rank_cd` among their newest 2,000, unchanged; documents through the BM25 door, or by `ts_rank_cd` among their newest 100 when it cannot answer. The page takes each kind's first, then each kind's second, documents before records at an equal place, then source and id, so the order is total and `OFFSET` exact. The door returns no score (a score per row re-scores it from its text), so there was nothing to compare a record's `ts_rank_cd` with; the same rule holds on both paths, so a page does not mix differently while an index is being built. `rank` on the wire becomes `1 / place`, an ordering key comparable within one answer.

**Paging over a door that pages nothing.** The door is asked for `offset + limit + 1` keys, clamped to Postgres's `integer`, which loses nothing because the door holds at most its two heads' keys. The page is ordered and cut over keys; text is joined and the excerpt cut for the page's rows alone.

**One fallback for two causes.** The worker asks `raw.search_document_bm25_ready` first and treats SQLSTATE 55000 from the door (classified by code in `repos/bm25Refusal.ts`) the same way: the search is asked again ADR 0123's way, in a fresh read-only frame on the same session, with what is left of the fifteen-second budget. Nothing reaches the reader as an error; `-xe` alone, which the door refuses, is answered as before.

**No new field: `capped` is the signal.** A `document` entry appears only when the door could not answer and more documents matched than the older path ranks -- exactly a page ranked among the newest 100. A document answer without it ranked every matching document. The Lake screen's note names the cause, the search index could not rank this search.

Rejected: a response field naming which ranking answered (its only actionable value is the one `capped` carries, and two signals for one fact can disagree), ADR 0123's cross-kind order on the fallback alone, re-scoring the door's page with `ts_rank_cd`, and a savepoint inside one frame. Consequences: a mixed search's first page shows each kind's best; a fallback costs the door's refusal (54-101 ms as the tenant's login) plus the older path, within one budget.

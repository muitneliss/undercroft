# 157. A search page interleaves its kinds by place, and `capped` names the older path

- Status: Accepted
- Date: 2026-11-06
- Amends: [ADR 0123](0123-search-ranks-the-newest-matches-found-through-the-index.md) on how the
  two kinds share a page and what `rank` is. Implements the worker's half of
  [ADR 0155](0155-search-ranks-through-a-bm25-index-per-tenant.md) as
  [ADR 0156](0156-bm25-search-as-measured-before-it-shipped.md) left it: the statement asks the
  door, and falls back when the door cannot answer.

## Context

ADR 0156 shipped the BM25 door and said the worker changes next. Switching the document half of
`lake.search` to it raised four questions the two ADRs leave to the caller.

1. **How do records and documents share a page?** ADR 0123 ordered the page by `ts_rank_cd`
   across both kinds, and called that a heuristic: a score over a short JSON payload and one over
   twenty pages of contract do not measure the same thing. The door returns keys in order and no
   score at all, because a score per row re-scores it from its text (680). There is nothing to
   compare a record's `ts_rank_cd` with.
2. **How does `offset` page over a door that pages nothing?** The door answers the first `n` keys
   of one fused order.
3. **What does `capped` mean for documents now?** ADR 0155 decision 4 left its shape open.
4. **Can a reader tell a page ranked by relevance from one ranked among the newest 100?**

## Decision

1. **Each kind is ranked within itself, and the page interleaves them by place.** Records by
   `ts_rank_cd` among their newest 2,000 (ADR 0123, unchanged; ADR 0155 decision 6). Documents
   through the door, or by `ts_rank_cd` among their newest 100 when it cannot answer. The page
   takes each kind's first, then each kind's second, documents before records at an equal place,
   and then source and id, so the order is total and `OFFSET` is exact. **The same rule on both
   paths**, so a page does not mix differently because an index was being built.
2. **`rank` is `1 / place`**, an ordering key comparable within one answer and never shown. No
   caller read it; it was `ts_rank_cd`.
3. **The door is asked for `offset + limit + 1` keys**, clamped to Postgres's `integer`. That
   clamp loses nothing: the door holds at most its two heads' keys (twice
   `raw.search_bm25_depth()`), so a page past them is either every match, answered, or past what
   it ranked, refused. The page is ordered and cut over keys; text is joined, and the excerpt
   cut, for the page's rows alone.
4. **Two ways the door cannot answer, one fallback.** The worker asks
   `raw.search_document_bm25_ready` first, and treats SQLSTATE 55000 from the door
   (`repos/bm25Refusal.ts`, by code, never by sentence) the same way. Either way the search is
   asked again ADR 0123's way, in a fresh read-only frame on the same session, with what is left
   of the fifteen-second budget. Nothing reaches the reader as an error.
5. **No new field. `capped` is the signal.** A `document` entry appears only when the door could
   not answer AND more documents matched than the older path ranks. That is exactly a page
   ranked among the newest 100; a document answer without it ranked every matching document,
   by BM25 or, with fewer than 101 matches, by `ts_rank_cd` over all of them. The Lake screen's
   note for documents names the cause: the search index could not rank this search.

## Options rejected

- **A response field naming which ranking answered** (`ranking: "bm25" | "newest"`). Its only
  value a reader can act on is the one `capped` already carries. When nothing was cut, both
  paths ranked every match by relevance, and "which scoring function" changes nothing a reader
  does. Two signals for one fact can disagree; the operational question -- has `search-index`
  reached this tenant -- belongs to `pg_index`, not to a reader's answer.
- **Keeping ADR 0123's cross-kind `ts_rank_cd` order on the fallback alone.** A page would then
  mix its kinds one way while the indexes are built and another way after, for the same words.
- **Re-scoring the door's page with `ts_rank_cd`** to keep a score to compare. It rebuilds the
  vectors ADR 0155 exists to stop rebuilding, and would order documents against the door's own
  order.
- **A savepoint inside one frame for the fallback.** It works, but the door's refusal then
  shares a transaction with the answer it was refused for; a fresh frame is the console's own,
  already shared, with nothing new to get right.

## Consequences

- A mixed search's first page now always shows each kind's best, where ADR 0123's order could
  fill it with one kind.
- A search that falls back costs the door's refusal plus the older path, within one budget. The
  door refuses in the time it ranks: 54-101 ms as the tenant's login on the bench (ADR 0156).
- `-xe` alone, which the door refuses, is answered ADR 0123's way, as it was before.

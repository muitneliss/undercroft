# 123. A search ranks each kind's newest matches, found through the index by the owner

- Status: Accepted
- Date: 2026-10-13
- Amends: [ADR 0026](0026-full-text-search-over-the-raw-lake.md). It changes how a search
  finds and ranks its rows and what it answers. The fold, the indexes, the tenant login and
  the length-preserving excerpt are unchanged.

## Context

`lake.search` timed out on an ordinary word. In the audit behind #447, all 17 calls in two
weeks were refused. Each one ran into the worker's 15 s statement timeout. The refusal then
told the caller that the processing service was not answering and to try again, which sent
agents round the same query.

The issue blamed the order of work: every match was ranked (`ts_rank_cd` over a rebuilt
tsvector) and excerpted before the page was cut. That was true, and it was the smaller half.
Planned as the tenant's dbt login, which is how the search runs (ADR 0026 §3), the statement
never used the GIN indexes at all, for a rare word as much as a common one:

- `@@` (`ts_match_vq`) is not `LEAKPROOF`.
- Under a row-level policy, Postgres will not make a non-leakproof operator an index condition
  ahead of the policy's own condition. The operator would otherwise see a row the policy was
  about to hide, and could leak it through an error.
- So every search rebuilt the folded vector of every row the tenant owned, up to 200,000
  characters each, and its cost grew with the lake rather than with the matches.

ADR 0026's plan test ran as the superuser, which the policy does not bind, so the gate never
saw this. A test now pins it from the tenant login's side.

## Decision

**1. Matches are found by two `SECURITY DEFINER` functions, as their owner, and answered as
keys.** `raw.search_record_candidates(p_role, q, n)` and `raw.search_document_candidates(...)`
live in `530_raw_search_candidates.sql`. Each answers one question: which of the caller's rows
match, newest first, at most `n`. The owner is the bootstrap superuser that applies the
migrations, as for `raw.tenant_of` and `ops.rotate_tenant_password`. The policy does not bind
it, so `@@` reaches the index. Inside, the body is fenced so that the tenant condition cannot
pull the plan onto the tenant btree, and sequential scans are off for that body alone. The
planner prices the vector rebuild as nearly free, which is exactly wrong.

**2. Everything shown is read afterwards, as the tenant, under the policy.** The search joins
those keys back to `raw.records` and `raw.document_text` as `undercroft_dbt_<slug>`, ranks
them, orders and pages them, and excerpts the page. The content still crosses only the
boundary ADR 0026 drew.

**3. Each kind ranks at most its newest `n`: 2,000 records and 100 documents.** It asks for
one more than the cap, so it knows when a kind was cut.

**4. A cut is reported, never silent.** `RawSearchResponse.capped` lists each kind that had
more matches than were ranked, with how many were ranked. It is on every page, including the
empty one past the end, because that is the page on which "no more hits" would otherwise read
as "nothing else matched". The Lake screen says it in a sentence, and the skill tells an agent
what it means.

**5. The excerpt is cut over the page alone.** It is computed in the outermost `SELECT`,
above the page's `LIMIT`. A test reads Postgres's own plan of the real statement to pin it.

**6. A statement timeout is its own refusal.** The worker classifies a Postgres 57014 whose
message names the statement timeout once, as `QueryTimedOut` (`queryTimeout.ts`).

- It answers `504 query_timeout`. A 57014 for a cancel by hand stays the unnamed failure it
  was.
- The control plane reads the search's 504 from the status alone. Only that endpoint maps it,
  and the body stays unread.
- The procedure refuses with `BAD_REQUEST`, which every door words as "change the input". The
  sentence, Vietnamese first, says that the search ran past its time limit, that running it
  again unchanged will stop again, and how to narrow it.

## Why the function returns only keys, and why that keeps the boundary

The function's privilege is that the policy does not stand between `@@` and the index.
Everything else is arranged so that this privilege buys nothing else:

- **Whose rows is decided by the policy's own function.** The caller passes `current_user`,
  and the body filters on `raw.tenant_of(p_role)`. That function answers only when
  `session_user` is a member of `p_role`, and a tenant login is a member of nothing but itself.
  A login naming another tenant's role gets `NULL`, and so no row. A test pins this as the
  login itself, through `SET SESSION AUTHORIZATION`, not through a `SET ROLE` of the superuser.
- **It returns a key and an ordinal, never a value.** No payload, no text and no date leaves
  it. The rank, the excerpt and the dates are read by the caller under the policy. A key the
  policy would not show joins to nothing there, so the most a wrong answer from the function
  could do is return fewer hits.
- **Its body is fixed.** The reader's text arrives as the source of a `tsquery`. No expression
  a tenant wrote is ever evaluated over another tenant's row, and that leak is what the
  leakproof rule exists to prevent.
- **Who may call it is a grant.** `EXECUTE` is revoked from `PUBLIC` and granted to each
  tenant's dbt login in `repeatable/010_provision_tenant.sql`, the one place a tenant grant is
  stated (`privileges.md`). The platform roles see every row already and get nothing.
- **Its search path is pinned** to `pg_catalog, raw`, and every name in the body is qualified.

Ownership is checked, not assumed. A test asserts that each function is `SECURITY DEFINER`,
pins its configuration, and is owned by the owner of `raw.records`, `raw.document_text` and
`raw.documents`, none of which forces its policy on its owner. A table that did force it would
put the policy back between `@@` and the index.

## Why the newest

Ranking every match is what took the time, so a search ranks a bounded set. That set has to be
one a reader can be told about in a sentence. "The newest 100 documents that matched" is that
sentence; "an arbitrary 100" is not one anybody can act on. Newest, by the date each hit shows
(`observed_at`, or a document's `extracted_at` when its catalogue row has gone), has four
properties:

- **It is the likeliest set to hold what an operator came for.** "Which invoice mentioned this"
  is usually asked about recent ones.
- **It is a total order.** Every page of one search ranks the same set, so paging neither
  skips nor repeats within it.
- **It costs nothing to compute.** The index finds the matches and the heap gives their dates,
  with no vector rebuilt.
- **A reader can widen it.** Adding a word or choosing a kind changes which rows are newest.

**Rejected: ranking whichever `n` the scan met first.** It is cheaper by one sort, but it is
not a set anyone can name. It is not stable between two pages either, because a parallel or
synchronised scan starts wherever it likes.

## Why these caps

A cap is a budget counted in vectors rebuilt, and a vector costs very different amounts in
the two kinds. The numbers below were measured in the gate's PGlite against this statement,
which is the only engine measured:

- 2,000 records of 1.5 KB rank in about 2 s.
- A 20 KB document ranks in about 13 ms.
- A full 200,000-character document ranks in about 130 ms, and costs about 200 ms more to
  excerpt.

At 100 documents the common case ranks in about 1.3 s. A lake made entirely of full-size
documents comes to about 13 s plus the page's excerpts. A cap set by that worst case would rank
a dozen documents. Past the budget, decision 6 says what happened. `RANKED_PER_KIND` in
`apps/worker/src/services/rawSearch.ts` holds the numbers beside the timeout. Both are budgets,
so both live in the layer that makes decisions.

## Options rejected

- **Cap the existing statement and nothing else.** That bounds a common word. A rare word still
  rebuilt the vector of every row the tenant owned, because the index was never used, so the
  cost still grew with the lake.
- **Run the search as `undercroft_worker`, whose policy is `USING (true)`.** The index would
  work. The boundary would then be a `tenant_id = $2` written in the statement, which is the
  isolation ADR 0026 §3 and ADR 0018 refuse to rest on.
- **A leakproof copy of `@@` with its own operator class.** `LEAKPROOF` is a superuser's claim
  that a function can reveal nothing about its arguments, made on Postgres's behalf about
  `ts_match_vq`, which Postgres itself does not make. It would also need a second operator
  class and a rebuilt index.
- **A stored tsvector beside each row.** It would make ranking cheap. ADR 0026 §2 rejected the
  generated column for the table rewrite it costs, and a side table would be a second writer
  of a projection that `LakeStore` does not own.

## Consequences

- One migration, `530_raw_search_candidates.sql`, and one grant added to
  `repeatable/010_provision_tenant.sql`.
- A match older than a kind's newest `n` is on no page. The answer says so, and the reader
  narrows the question. This is the cost of answering at all.
- A quoted phrase makes Postgres recheck each row that holds every word, rebuilding its vector.
  Those rows are fewer than any one word's matches, but on a very large lake a phrase of
  common words can still be slow, and then decision 6 reports it.
- `lake.query` keeps its own wording for a timeout: Postgres's sentence, quoted as the author's
  query failing. It is SQL the author wrote, and "narrow it with more words" is not advice
  about SQL.
- ADR 0026's plan tests still run as the superuser. They prove the expression in the
  statement and the expression on the index are the same one. What the tenant login reaches
  is proven beside them.

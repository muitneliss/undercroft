# 156. BM25 search, as measured before it shipped

- Status: Accepted
- Date: 2026-11-06
- Amends: [ADR 0155](0155-search-ranks-through-a-bm25-index-per-tenant.md) decisions 1, 3 and 5.
  Its isolation design (decision 2), its door (decision 3's boundary) and its two indexes per
  tenant stand; what changes is how the second index is declared, how the door filters and
  ranks, how indexes are built, and how the service that builds them runs.
- Evidence: the bench ADR 0155's plan asked for before implementation: real Postgres 17 with
  production's 1 GB limit, 191,200 synthetic documents, one tenant of 172,000. The service's
  deploy behaviour was measured on Docker Compose v5.5.0. The numbers that decided something
  are quoted here; the scripts stay outside the repository, as the spike's did.

## Context

ADR 0155 was accepted on a one-day spike that measured ONE index. Its implementation plan
required measuring the two-index design, the fusion and the builds before anything shipped.
Those measurements contradicted four details of the ADR, and the implementation found a fifth
in the deploy itself. ADRs are immutable, so the corrections are recorded here.

## What was measured, and what it decides

1. **Two BM25 indexes on the same expression are ambiguous.** Declared as ADR 0155 decision 1
   says -- both on `raw.fold(left(text, raw.search_cap()))` -- the planner picks one, and a
   query whose `to_bm25query` names the other fails: "query specifies index X but planner
   chose index Y".
   - **Decided:** the `english` index is declared on `raw.search_text_english(text)`, a wrapper
     whose answer is the same folded text. Its `SET search_path` clause stops the planner
     inlining it; inlined, it would be the simple expression again. The `simple` index stays
     on the fold. Verified on the bench.

2. **Negated terms must not reach BM25.** BM25 knows no operators. Given `-xe hop dong` whole,
   it ranked the documents HOLDING `xe` first; the all-terms filter then removed every one of
   them, and the search answered nothing.
   - **Decided:** what is ranked is the query's positive terms alone, folded
     (`raw.search_bm25_terms`): negated words and phrases removed, quotes and `or` dropped.
     What a query means -- every term, the phrases, the negations -- is decided by the filter
     alone, exactly as before.

3. **The filter goes through the GIN index's keys, not `@@` on each ranked row.** ADR 0155
   decision 3 filtered the BM25 rows with `raw.search_tsv(text) @@ raw.search_query(q)`, which
   rebuilds each row's vector: 2-8 s at a depth of 3,000. A semi-join with the keys the GIN
   index finds cost 100-353 ms, nearly whatever the depth.
   - **Decided:** `raw.search_document_matches` answers the matching keys through the GIN
     index, unordered and unlimited. It is 620's `raw.search_document_candidates` without the
     join to `raw.documents` and the newest-first sort, which the door does not need, with every
     guarantee of 530's header: `SECURITY DEFINER`, whose rows by `raw.tenant_of(p_role)`, keys
     only, a fixed body, `enable_seqscan = off` and the `OFFSET 0` fence, and the same stream
     narrowing.

4. **The fusion reads each index to a depth of 10,000.** Each index is read in BM25 order, keys
   only -- `<@>` in a select list re-scores from the text, about 2.3 ms a row -- and the two
   orders are fused by reciprocal rank fusion, `sum(1 / (60 + rank))`, then kept to the
   matching keys and paged. At a depth of 10,000, every tested query's page equalled the page
   at 20,000, in 130-353 ms.
   - **Decided:** `raw.search_bm25_depth()` is 10,000, a stated budget beside its measurement
     in `680_bm25_search.sql`, the way `raw.search_cap()` is.

5. **A search the door cannot answer goes ADR 0123's way, and the caller can tell.**
   - **Decided:** `raw.search_document_bm25_ready(p_role)` answers whether both of the caller's
     indexes exist and are valid and ready. The caller asks it first.
   - **Decided:** the door REFUSES, with SQLSTATE 55000 (`object_not_in_prerequisite_state`),
     rather than answer a page that is not what it says: when the indexes are not ready (an
     index dropped between the two calls), and when its page is shorter than asked while more
     documents match than the page holds -- those matches lie past both heads, or the query has
     no positive term (`-xe` alone). A short page would read as "no more hits". The caller then
     ranks with `raw.search_document_candidates`.

6. **Builds: parallel for a large tenant, serial otherwise.** ADR 0155 decision 1 made every
   build serial, because a parallel build of a partial expression index evaluates the
   expression for every row of the table (timescale/pg_textsearch#593: 200 documents, 111 s
   parallel against 96 ms serial). But a serial build bloats: for the 172,000-document tenant
   the `simple` index was 421 MB and the `english` 778 MB serially, and a serial
   `REINDEX CONCURRENTLY` 781 MB, against 214 MB in parallel.
   - **Decided:** a tenant holding at least a quarter of `raw.document_text`'s rows is built and
     reindexed with parallel workers, every other tenant serially. The quarter is a judgement
     between the two measurements -- the rows it does not own cost it at most three times its
     own, split across the workers -- not a measured optimum.
   - `ops.provision_tenant` still builds a tenant with no documents, serially, and now only
     when it can take the table's SHARE lock at once (`NOWAIT`); otherwise it leaves the index
     missing for `search-index`, rather than queue every tenant's extraction behind it.

7. **`search-index` is the bootstrap role's, and stays up.**
   - `GRANT MAINTAIN` let `undercroft_worker` `REINDEX CONCURRENTLY` but not `CREATE INDEX`,
     which needs the table's owner. So building and reindexing both live in `search-index`,
     connected as the bootstrap role like `db-migrate`. Moving the reindex to a Kestra-scheduled
     worker verb would split one job across two roles for no gain.
   - `docker compose up --wait` -- the deploy -- returned in 25 s while a one-shot that nothing
     depended on was still running a build. A deploy during a build kills it and leaves an
     INVALID index. So a pass drops an invalid index `CONCURRENTLY` and builds it again, and
     drops the invalid `_ccnew` copy a cut-short reindex leaves.
   - **Found while implementing, and the reason the service is not a one-shot:** `--wait` FAILS
     on a container that nothing depends on and that has already exited. Measured on Compose
     v5.5.0: `container ... exited (0)`, exit status 1. A pass with nothing to do exits in a
     second, so a one-shot `search-index` would fail every ordinary deploy, and making
     something depend on it with `service_completed_successfully` would make the deploy wait
     for a first build of many minutes. **Decided:** the service is long-running
     (`restart: unless-stopped`): a pass at start, then one every six hours, which is also the
     schedule the growth rule needs between releases. `cd:verify` reads it as the long-running
     service it is. `task db:search-index` runs one pass and exits.
   - **Decided:** an index is reindexed once it is at least twice its size at its last build
     and at least 64 MiB larger (re-extraction grew one 216 -> 362 MB, and `VACUUM` does not
     shrink it). The sizes are kept in `ops.search_index_build`, which only `search-index`
     reads and writes. One pass at a time, by a session advisory lock: a killed container's
     backend may still be finishing its build, and a second pass must not drop that index as
     invalid while it is being made.

8. **Isolation, pinned.** The membership oracle ADR 0155 measured (a word the other tenant holds
   scores -2.17, one it lacks 0) needs only USAGE on the extension's schema. So pg_textsearch
   lives in `search_ext`, which grants USAGE to nobody; the schema is named in the explicit
   refusals for tenant, BI and scope logins (`repeatable/010_provision_tenant.sql`) and for
   the platform roles (`680_bm25_search.sql`); and the door derives both index names from
   `raw.tenant_of(p_role)` through `raw.search_index_name`, the one derivation, by hash, so a
   name is 43 characters whatever the tenant. `privileges.test.ts` pins it from both sides: the
   probe answers the oracle to the role that may reach the extension, and is refused
   "permission denied for schema search_ext" to a tenant's dbt login.

## Options rejected

- **Two indexes on one expression, telling the planner which to use.** There is no hint
  mechanism, and the failure is an error, not a slow plan.
- **The whole query as BM25 text.** Measured: it ranks what the reader excluded first.
- **Filtering each ranked row with `@@`** (ADR 0155 as written). Measured at 2-8 s.
- **Reusing `raw.search_document_candidates` as the filter.** It sorts every match newest
  first, and joins `raw.documents` to date them, for a set the door only probes.
- **Numbering the ranked head with `row_number() OVER ()` over an ordered subquery.** Postgres
  only usually keeps that order. The head is a function the door numbers `WITH ORDINALITY`,
  which numbers rows in the order the function returned them -- a guarantee.
- **The door falling back by itself.** Its page would then be in one of two orders with one of
  two cut rules, and the caller, which tells the reader whether the result was capped, could
  not know which. The door refuses, and the caller chooses.
- **A one-shot `search-index`**, or one something depends on. Measured above.
- **Serial builds for every tenant** (ADR 0155 as written). Measured above: twice to nearly
  four times the size.

## Consequences

- The worker's statement must ask `raw.search_document_bm25_ready` before it reads the door, and
  treat SQLSTATE 55000 from the door as "rank ADR 0123's way". Nothing calls the door until it
  does; this ADR's implementation ships the SQL and the service, and the worker changes next.
- **Not measured:** the cost of the head for a reader narrowed to a few streams (the extension
  post-filters and grows its batch until the depth is filled), the parallel threshold at
  exactly a quarter, a reindex on production's CPU, and the six-hour pass's cost against a
  thousand tenants.
- **Seen in the gate, unchanged here:** `raw.search_tsv` concatenates the `simple` and `english`
  vectors, so a quoted phrase can match across the seam -- a document ending in `thuê` and
  beginning with `nhà` matches `"thue nha"`. That is ADR 0026's behaviour, older than this ADR,
  and the BM25 path inherits it through the filter.
- The gate cannot show a second session: a lock `provision_search_indexes` could not take at
  once, a build another backend is running, the advisory lock held elsewhere. Those belong to
  the integration tier.

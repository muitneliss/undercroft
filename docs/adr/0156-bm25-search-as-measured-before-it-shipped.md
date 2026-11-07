# 156. BM25 search, as measured before it shipped

- Status: Accepted
- Date: 2026-11-06
- Amends: [ADR 0155](0155-search-ranks-through-a-bm25-index-per-tenant.md) decisions 1, 2, 3 and 5. Its door (decision 3's boundary) and its two indexes per tenant stand. What changes is how
  the second index is declared, how the door filters and ranks, how indexes are built, how the
  service that builds them runs, and -- decision 2 -- which privilege keeps a tenant from the
  extension: EXECUTE, where ADR 0155 said USAGE.
- Evidence: the bench ADR 0155's plan asked for before implementation: real Postgres 17 with
  production's 1 GB limit, 191,200 synthetic documents, one tenant of 172,000. The service's
  deploy behaviour was measured on Docker Compose v5.5.0. The numbers that decided something
  are quoted here; the scripts stay outside the repository, as the spike's did.

## Context

ADR 0155 was accepted on a one-day spike that measured ONE index. Its implementation plan
required measuring the two-index design, the fusion and the builds before anything shipped.
Those measurements contradicted several details of the ADR. The implementation then found one
more in the deploy itself, and a second bench round -- the door measured as a tenant's own login,
on indexes `search-index` built -- found two in the extension: its planner hook, and its builds.
ADRs are immutable, and this one is not yet merged, so all of them are recorded here.

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

6. **Builds are serial, and the bloat is accepted.** ADR 0155 decision 1 made every build
   serial, because a parallel build of a partial expression index evaluates the expression for
   every row of the table (timescale/pg_textsearch#593: 200 documents, 111 s parallel against
   96 ms serial). A serial build bloats: for the 172,000-document tenant the `simple` index was
   421 MB and the `english` 778 MB, and a serial `REINDEX CONCURRENTLY` 781 MB, against 214 MB for
   a parallel build that is not concurrent. The first version of `search-index` therefore built
   a tenant holding a quarter of the rows in parallel. Watching `pg_stat_activity` during its
   pass on the bench showed that this was dead code: a `CREATE INDEX CONCURRENTLY` on
   pg_textsearch ran in the client backend alone, with no parallel worker, and the "parallel"
   builds came out 781 MB and 778 MB, the serial sizes.
   - **Decided:** every build and reindex is serial (`max_parallel_maintenance_workers = 0`,
     which also keeps #593 away should a later release parallelise it), and the bloat is
     accepted. The latency below was measured on those bloated indexes, production has about
     79 GB free, and the alternative -- a non-concurrent parallel build -- holds a SHARE lock on
     `raw.document_text`, every tenant's extraction, for the whole build. The growth rule (7)
     stays, so an index re-extraction has grown is rebuilt.
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

8. **The planner hook resolves its names through the backend's `search_path`, so the tenant
   login has USAGE on `search_ext` -- and EXECUTE on nothing in it.** Measured on the bench as the
   tenant's own dbt login, logging in as it (`SET SESSION AUTHORIZATION` starts the backend as the
   superuser, which hides this), the door took 11-42 s a search, 18-21 s of it in the two head
   scans at depth 10,000. Postgres was evaluating the ORDER BY expression -- the fold, then
   `<@>`, which tokenizes and scores -- for every row the index returned, about 1.8 ms a row.
   pg_textsearch has a planner hook that replaces that resjunk expression with
   `bm25_get_current_score()`, a stub returning the score the index scan already computed
   (`src/planner/hooks.c`, `replace_scores_in_targetlist`). But the hook resolves the operator
   and the stub with UNQUALIFIED lookups through `search_path`, and the result is in effect fixed
   at the backend's first statement:
   - a `search_path` set at connection (the role's default, or `PGOPTIONS`) gets the stub;
   - a `SET search_path` inside the session does not, nor does the default path;
   - inside the door, with `SET search_path = pg_catalog, raw`, the hook found the operator and
     failed on the stub: "function bm25_get_current_score() does not exist";
   - in a session without the hook, the index name given to `to_bm25query` was not validated:
     the planner silently used a different index.
   - **Decided:** the tenant's dbt login gets USAGE on `search_ext` and a role default
     `search_path` of Postgres's default with `search_ext` appended last (`"$user", public,
search_ext`, so no name it resolves today resolves to anything else), and the door and its
     head carry `pg_catalog, raw, search_ext`. Nothing else in the repository reads that login's
     default path: the dbt profile names schemas and sets none, and the worker sets one only per
     transaction, for an author's query. A pooled backend takes the new default at its next
     connection, at most PgBouncer's `SERVER_LIFETIME` (an hour) after the deploy.
   - **Decided:** the membership oracle ADR 0155 measured (a word the other tenant holds scores
     -2.17, one it lacks 0) is closed by EXECUTE instead of USAGE. `680_bm25_search.sql` revokes
     EXECUTE on every function in `search_ext` from PUBLIC -- an extension creates its functions
     with Postgres's default, EXECUTE for PUBLIC -- so the tenant login can run none of them, and
     the probe is refused "permission denied for function bm25_text_bm25query_score". **Any
     future `ALTER EXTENSION pg_textsearch UPDATE` migration must repeat that revoke.** BI and
     scope logins and the platform roles have no USAGE at all, and stay in the explicit
     refusals. The door derives both index names from `raw.tenant_of(p_role)` through
     `raw.search_index_name`, the one derivation, by hash, so a name is 43 characters whatever the
     tenant.
   - Measured with this, as the tenant login, both heads at depth 10,000 with the fusion, the
     matches and a 21-row page: `do van an` 101 ms, `Đỗ Văn An` 101 ms, `thuong` 99 ms,
     `"van an"` 96 ms, `hop dong` 68 ms, `contract` 66 ms, `-xe hop dong` 54 ms (21 rows each);
     `-xe` alone is refused with 55000 as decision 5 says; a word no document holds answers no
     row in 0.8 ms.
   - `privileges.test.ts` pins it: no BI, scope or platform login has USAGE; a tenant's dbt login
     has USAGE and EXECUTE on none of the schema's functions, enumerated from `pg_proc` so one a
     future release adds is covered; the role default is restored by re-provisioning; and the
     probe answers the oracle to a role that may run the extension and is refused to a tenant's
     dbt login.
   - **Upstream:** pg_textsearch should resolve these OIDs in its own extension schema rather
     than through `search_path`. timescale/pg_textsearch#551 already reports the per-row
     re-scoring; the root cause in `get_bm25_oids()`, the `bm25_get_current_score() does not
exist` error inside a `SECURITY DEFINER` function, and the unenforced explicit index name
     were added to it as a comment, with a reproduction on a clean database. When it is fixed,
     the role-level path and the functions' `search_ext` entry can be reconsidered; the revoked
     EXECUTE stays either way.

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
- **Parallel builds for a large tenant.** Measured above: a concurrent build does not use them.
- **A non-concurrent parallel build**, the one build that is not bloated. It holds a SHARE lock on
  `raw.document_text` for the whole build, which stops every tenant's extraction.
- **Keeping ADR 0155's "no USAGE for any tenant login".** Measured above: without it the hook never
  resolves its stub for a tenant backend, and every search re-scores each ranked row.
- **Setting `search_path` per session or per transaction** in the worker. Measured above: the hook
  has settled by then.

## Consequences

- The worker's statement must ask `raw.search_document_bm25_ready` before it reads the door, and
  treat SQLSTATE 55000 from the door as "rank ADR 0123's way". Nothing calls the door until it
  does; this ADR's implementation ships the SQL and the service, and the worker changes next.
- **Not measured:** the cost of the head for a reader narrowed to a few streams (the extension
  post-filters and grows its batch until the depth is filled), production-CPU timings of the
  door, a reindex on production's CPU, and the six-hour pass's cost against a thousand tenants.
- **Seen in the gate, unchanged here:** `raw.search_tsv` concatenates the `simple` and `english`
  vectors, so a quoted phrase can match across the seam -- a document ending in `thuê` and
  beginning with `nhà` matches `"thue nha"`. That is ADR 0026's behaviour, older than this ADR,
  and the BM25 path inherits it through the filter.
- The gate cannot show a second session: a lock `provision_search_indexes` could not take at
  once, a build another backend is running, the advisory lock held elsewhere. Nor can it show the
  hook: PGlite runs one backend, started as the superuser, so whether a tenant login's backend
  gets the cached-score stub, and the latency that buys, is measured against real Postgres only.
  The gate pins the settings a real backend starts with, and the index order.
- **With USAGE, a tenant's dbt login can do two things it never needs.** It can build a bm25
  index on a table of its own, over its own text -- no other tenant's statistics are in it, but it
  draws on the extension's shared memory budget (`pg_textsearch.memory_limit`). And the
  `bm25query` type's input function, which Postgres runs without an EXECUTE check, resolves the
  index name it is given, so the login can ask whether an index of a given name exists; the names
  are a hash of the tenant id and say nothing about any document. Scoring is refused either way.
  Whether the first was possible without USAGE was not checked.

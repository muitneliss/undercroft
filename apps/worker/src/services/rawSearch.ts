/**
 * Searching the raw lake, answered as the tenant's dbt login.
 *
 * WHY THE WORKER AND NOT THE CONTROL PLANE. The same reason `runRawQuery` is here (ADR 0016):
 * the worker is the one process that can mint a tenant login's password, so a compromised
 * control plane still cannot obtain any tenant's database login. It matters more for search
 * than for the console, because `undercroft_app` is deliberately denied the `text` column of
 * `raw.document_text` (180's docstring) and this feature does not change that by one column --
 * the text is read by the dbt login, which already holds it, and only an excerpt crosses back.
 *
 * WHAT MAKES IT SAFE is Postgres, not this module: the dbt login has no USAGE on `app` or
 * `ops`, so no credential is reachable, and the row-level policy on `raw` is keyed on
 * `raw.tenant_of(current_user)` -- the one input a session cannot change. The read-only frame
 * below takes away the one thing that login CAN do, which is create in its own two schemas.
 *
 * Nothing here decides a status code. A tenant with no roles raises, because "no such tenant"
 * and "nothing matched" are different facts and only one of them is somebody's to fix. A search
 * Postgres cancelled at its time limit raises `QueryTimedOut`: the reader can fix that by
 * narrowing the question, and asking it again unchanged would only take as long again.
 */

import type { RawSearchResponse, SearchKind } from "@undercroft/contracts";
import { tenantRolesFor } from "@undercroft/db/repos";

import { type SearchStream, searchLake } from "../repos/rawSearch.ts";
import type { QueryDeps } from "./queryRunner.ts";
import { QUERY_TIMEOUT_MS } from "./queryRunner.ts";
import { isStatementTimeout, QueryTimedOut } from "./queryTimeout.ts";
import { TenantNotProvisioned } from "./tenantSession.ts";

/**
 * How many of each kind's matches a search ranks, newest first, where it ranks them ADR 0123's
 * way: records always (ADR 0155 decision 6), documents only when the BM25 door could not answer
 * (below). Through the door a document search ranks every match and has no cap.
 *
 * Ranking a match ADR 0123's way means rebuilding its folded tsvector, so the cap is a budget
 * counted in vectors rebuilt, and one vector costs very different amounts in the two kinds. A
 * record is a JSON payload of a kilobyte or two. A document's text runs to 200,000 characters
 * (`raw.search_cap()`). So the caps differ by kind rather than sharing one number.
 *
 * Measured read-only on production (ADR 0154), in a tenant of 191,250 documents and 246,221
 * records, for a name that matched 10 records and 531 documents. The candidate lookups took 8 ms
 * and 11 ms; the rest is ranking and the page's excerpts. With the fold as 190 spelled it, the
 * statement took 17.07 s: ranking the 100 newest documents (averaging 36,037 characters) took
 * about 10 s, and the 21-row page's excerpts about 6.4-7.25 s. With the fold respelled in 670,
 * ranking them took 3.62 s and the excerpts about 0.2 s; 670 also folds each text once rather
 * than twice, which a bench measured as a further third off building a vector.
 *
 * The worst case is a lake whose 100 newest matches all sit at the 200,000-character cap. On
 * production's CPU that ranks in about 13 s with 670 in full, before the page's excerpts: under
 * the timeout with little room -- which is the case ADR 0155 moved documents to the door for.
 * Past the budget, the timeout's refusal says what happened and to narrow the question.
 */
export const RANKED_PER_KIND: Readonly<Record<SearchKind, number>> = {
  record: 2000,
  document: 100,
};

export interface SearchInput {
  readonly tenantId: string;
  readonly q: string;
  readonly kinds: readonly SearchKind[];
  readonly limit: number;
  readonly offset: number;
  /**
   * The streams the reader reaches, a whole source where `entity` is `null` (ADR 0142); absent
   * for a reader who reaches the whole lake. Narrowed before anything is ranked, on both paths.
   */
  readonly streams?: readonly SearchStream[];
}

/**
 * One page of hits over one tenant's lake.
 *
 * DOCUMENTS RANK THROUGH THE BM25 DOOR WHEN IT CAN ANSWER, and ADR 0123's way when it cannot
 * (ADR 0155, ADR 0156 decision 5): while the tenant's indexes are missing or being built, and
 * when the door refuses a page shorter than the matches -- past the depth it ranks, or a query
 * with nothing positive to rank by, `-xe` alone. That is decided here, per search, and never
 * reaches the reader as an error: the older path answers, and its `capped` says when it ranked
 * only the newest documents, which is the one difference a reader can act on. Records are ranked
 * ADR 0123's way on both paths, so a search of records alone never asks the door.
 *
 * ONE TIME BUDGET FOR THE QUESTION. The door's refusal costs what ranking cost it -- 54-101 ms
 * as the tenant's login on the bench (ADR 0156) -- and the older path is given what is left of
 * the fifteen seconds, not fifteen more, so a search that falls back never runs twice as long as
 * a reader was told it may, nor past the control plane's own wait for the worker.
 *
 * The frame is the console's own (`repos/queries.ts`, `inReadOnlyTransaction`), shared rather
 * than spelled again here: it is a security boundary, and a second spelling is a second place
 * for `SET TRANSACTION READ ONLY` to be left out. The timeout is passed rather than assumed,
 * because how long a reader's search may run is a decision and this is the layer that makes
 * decisions -- the same fifteen seconds the console gets, for the same reason.
 */
export async function searchRaw(deps: QueryDeps, input: SearchInput): Promise<RawSearchResponse> {
  const roles = await tenantRolesFor(deps.exec, input.tenantId);
  if (roles === null) {
    throw new TenantNotProvisioned(input.tenantId);
  }
  const started = performance.now();
  try {
    // THE SESSION'S FIRST STATEMENT MUST NOT SET `search_path` (ADR 0156 decision 8).
    // pg_textsearch's planner hook finds its cached-score stub through the path the backend's
    // first statement had, which for this login is its role default, `search_ext` included. A
    // path set as this session's first statement would leave the hook without it, and the door
    // would re-score every ranked row from its text: 11-42 s a search on the bench instead of
    // 54-101 ms. One set later cannot help and was not measured to be harmless, so none is set
    // at all: `searchLake` qualifies every name, and its frame is given no `schema`.
    return await deps.sessions.as({ tenantId: input.tenantId, kind: "dbt" }, async (exec) => {
      const scope = {
        tenantId: input.tenantId,
        q: input.q,
        kinds: input.kinds,
        limit: input.limit,
        offset: input.offset,
        streams: input.streams ?? null,
        caps: RANKED_PER_KIND,
      };
      const ranked = input.kinds.includes("document")
        ? await searchLake(exec, { ...scope, timeoutMs: QUERY_TIMEOUT_MS, ranking: "bm25" })
        : null;
      const page =
        ranked ??
        (await searchLake(exec, {
          ...scope,
          timeoutMs: remainingOf(QUERY_TIMEOUT_MS, started),
          ranking: "newest",
        }));
      return {
        // `limit + 1` came back if there was one, so the page can say it was cut rather than
        // leave a reader to infer it from a full one.
        hits: page.hits.slice(0, input.limit),
        truncated: page.hits.length > input.limit,
        capped: page.capped.map((kind) => ({ kind, ranked: RANKED_PER_KIND[kind] })),
      };
    });
  } catch (error) {
    throw isStatementTimeout(error) ? new QueryTimedOut(QUERY_TIMEOUT_MS, { cause: error }) : error;
  }
}

/** The least a fallback is given; see `remainingOf`. */
const MIN_ATTEMPT_MS = 1000;

/**
 * What is left of `budgetMs` since `started`, never under a second: a fallback started at the
 * very end of the budget still gets to try, and a timeout then says the search ran long, which
 * it did.
 */
function remainingOf(budgetMs: number, started: number): number {
  return Math.max(MIN_ATTEMPT_MS, Math.round(budgetMs - (performance.now() - started)));
}

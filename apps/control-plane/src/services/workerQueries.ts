/**
 * The worker's reads, each routed by what its reader may read (ADR 0142): a report's query and
 * the analytics schema, as the customer's BI login or -- for a reader of fewer than every model --
 * its scope login; the raw console, as the build login; and the lake search, whole or narrowed
 * to the streams the reader reaches.
 *
 * Which login is the ROUTE's, never a field's. A narrowed read goes to the narrowed route and
 * nowhere else: a worker older than scopes has no such route and answers 404, which is a refusal
 * -- where it would have stripped a field it did not know and answered as a login that sees more.
 * The worker and the control plane deploy separately, so that difference is the whole of what
 * keeps a deploy in progress from widening anybody's reach.
 *
 * A scope that limits rows or columns (ADR 0143) goes to a route newer still, `/limited/…`: a
 * worker that knows scopes and not rules would strip `limits` and read as a login that sees every
 * row of the scope's tables. A scope without rules keeps PR 3's route, which every worker since
 * has.
 */

import type { QueryAnswer, QueryScope } from "@undercroft/contracts";
import type { QueryInput, WorkerClient, WorkerOutcome } from "./workerClient.ts";
import { postTo } from "./workerPost.ts";
import { BAD_REQUEST, SEARCH_REFUSALS } from "./workerRefusals.ts";
import { envelopeOf, exchange, type WorkerTransport } from "./workerTransport.ts";

/**
 * The other call whose refusal body IS read: a 400 `query_failed` carries Postgres's sentence
 * about the author's SQL, which quotes the author's own text and nothing else, and is the one
 * thing that lets them fix it. Every other status is handled as `post` handles it.
 *
 * At module scope, for the reason `WorkerTransport`'s own docstring gives: a request helper that
 * can be read on its own is one a reviewer can check against the endpoint it calls.
 */
function queryOn(t: WorkerTransport): typeof query {
  function query(
    path: string,
    input: QueryInput & { readonly scope?: QueryScope },
  ): Promise<WorkerOutcome<QueryAnswer>> {
    return exchange(t, { path, body: input }, async (response) => {
      if (response.status === BAD_REQUEST) {
        const refusal = await envelopeOf(response);
        if (refusal?.code === "query_failed" && typeof refusal.message === "string") {
          return { ok: false, reason: "query-failed", message: refusal.message };
        }
        return { ok: false, reason: "refused" };
      }
      if (!response.ok) {
        return { ok: false, reason: "refused" };
      }
      return { ok: true, value: (await response.json()) as QueryAnswer };
    });
  }
  return query;
}

/** The route a scoped read of `verb` takes: `limited` when its scope carries rules (see above). */
export function scopedRoute(scope: QueryScope, verb: "run" | "schema" | "export"): string {
  return scope.limits.length === 0 ? `/v1/queries/scoped/${verb}` : `/v1/queries/limited/${verb}`;
}

export function queriesOn(
  t: WorkerTransport,
): Pick<WorkerClient, "runQuery" | "readSchema" | "runRawQuery" | "readRawSchema" | "searchRaw"> {
  const post = postTo(t);
  const query = queryOn(t);
  return {
    runQuery: ({ scope, ...input }) =>
      scope === null
        ? query("/v1/queries/run", input)
        : query(scopedRoute(scope, "run"), { ...input, scope }),
    readSchema: ({ scope, tenantId }) =>
      scope === null
        ? post("/v1/queries/schema", { tenantId })
        : post(scopedRoute(scope, "schema"), { tenantId, scope }),
    // The raw lake's console. Same refusal handling, different login at the far end: the
    // worker answers this one as the tenant's dbt role, which is the only one that may read
    // `raw` at all. See `queryRunner.runRawQuery`.
    runRawQuery: (input) => query("/v1/queries/raw/run", input),
    readRawSchema: (input) => post("/v1/queries/raw/schema", input),
    // Plain `post`, not `query`: there is no author's SQL here to quote back, so there is no
    // refusal body worth reading. Its one refusal of its own -- the statement timeout, a 504 --
    // is named by the status alone (ADR 0123).
    searchRaw: ({ streams, ...input }) =>
      streams === null
        ? post("/v1/queries/raw/search", input, { refusals: SEARCH_REFUSALS })
        : post(
            "/v1/queries/raw/search/within",
            { ...input, streams },
            { refusals: SEARCH_REFUSALS },
          ),
  };
}

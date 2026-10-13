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

import { searchLake } from "../repos/rawSearch.ts";
import type { QueryDeps } from "./queryRunner.ts";
import { QUERY_TIMEOUT_MS } from "./queryRunner.ts";
import { isStatementTimeout, QueryTimedOut } from "./queryTimeout.ts";
import { TenantNotProvisioned } from "./tenantSession.ts";

/**
 * How many of each kind's matches a search ranks, newest first (ADR 0123).
 *
 * Ranking a match means rebuilding its folded tsvector, so the cap is a budget counted in
 * vectors rebuilt, and one vector costs very different amounts in the two kinds. A record is a
 * JSON payload of a kilobyte or two. A document's text runs to 200,000 characters
 * (`raw.search_cap()`). Measured in the gate's PGlite against this statement, the only engine
 * measured:
 *
 * - 2,000 records of 1.5 KB rank in about 2 s, about 1 ms each.
 * - Documents of 20 KB rank at about 13 ms each.
 * - Documents of the full 200,000 characters rank at about 130 ms each, and their excerpts
 *   cost about 200 ms each on the page.
 *
 * So the caps differ by kind rather than sharing one number. At 100 documents the common case
 * ranks in about 1.3 s. A lake made entirely of full-size documents comes to about 13 s plus
 * the page's excerpts. A cap set by that worst case would rank a dozen documents; past it, the
 * timeout's refusal says what happened and to narrow the question.
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
}

/**
 * One page of hits over one tenant's lake.
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
  try {
    return await deps.sessions.as({ tenantId: input.tenantId, kind: "dbt" }, async (exec) => {
      const page = await searchLake(exec, {
        tenantId: input.tenantId,
        q: input.q,
        kinds: input.kinds,
        limit: input.limit,
        offset: input.offset,
        timeoutMs: QUERY_TIMEOUT_MS,
        caps: RANKED_PER_KIND,
      });
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

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
 * and "nothing matched" are different facts and only one of them is somebody's to fix.
 */

import type { RawSearchResponse, SearchKind } from "@undercroft/contracts";
import { tenantRolesFor } from "@undercroft/db/repos";

import { searchLake } from "../repos/rawSearch.ts";
import type { QueryDeps } from "./queryRunner.ts";
import { QUERY_TIMEOUT_MS } from "./queryRunner.ts";
import { TenantNotProvisioned } from "./tenantSession.ts";

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
  return deps.sessions.as({ tenantId: input.tenantId, kind: "dbt" }, async (exec) => {
    const rows = await searchLake(exec, {
      tenantId: input.tenantId,
      q: input.q,
      kinds: input.kinds,
      limit: input.limit,
      offset: input.offset,
      timeoutMs: QUERY_TIMEOUT_MS,
    });
    // `limit + 1` came back if there was one, so the page can say it was cut rather than leave
    // a reader to infer it from a full one.
    return { hits: rows.slice(0, input.limit), truncated: rows.length > input.limit };
  });
}

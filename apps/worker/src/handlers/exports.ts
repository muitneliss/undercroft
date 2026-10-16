/**
 * `POST /v1/queries/export`: every row of an author's SELECT as a CSV stream, as the tenant's
 * read-only login (ADR 0111).
 *
 * Beside the query routes in `analytics.ts`, behind the same service token, and its own module
 * because its answer is the one that is not JSON. Every refusal arrives before the first byte,
 * through the boundary: 400 `query_failed` with Postgres's sentence, 503 `tenant_busy` when no
 * export turn or connection was free in time. After the first byte nothing can change the
 * status, so a failure then cuts the body instead (`services/queryExport.ts`), and the control
 * plane's client sees a download that failed rather than one that ended early.
 */

import {
  CSV_MEDIA_TYPE,
  ExportQueryRequest,
  ScopedExportQueryRequest,
} from "@undercroft/contracts";
import { liftIdleTimeout } from "@undercroft/core";
import type { Hono } from "hono";
import { exportQuery } from "../services/queryExport.ts";
import { UNAUTHENTICATED, serviceTokenOk } from "./bearer.ts";
import type { LakeApiDeps } from "./lake.ts";

/**
 * The export routes: `/v1/queries/export` as the BI login, and `/v1/queries/scoped/export` as
 * the scope login of the models the request names (ADR 0142) -- and `/v1/queries/limited/export`
 * for a scope that also carries row or column rules (ADR 0143). One handler: which login reads is
 * the route's, so a control plane newer than this worker can never have a scope, or its rules,
 * stripped and answered as a login that reads more -- the older worker has no such route.
 */
export function registerExportRoute(app: Hono, deps: LakeApiDeps): void {
  registerExportAt(app, deps, "/v1/queries/export", ExportQueryRequest);
  registerExportAt(app, deps, "/v1/queries/scoped/export", ScopedExportQueryRequest);
  registerExportAt(app, deps, "/v1/queries/limited/export", ScopedExportQueryRequest);
}

function registerExportAt(
  app: Hono,
  deps: LakeApiDeps,
  path: string,
  schema: typeof ExportQueryRequest | typeof ScopedExportQueryRequest,
): void {
  app.post(path, async (c) => {
    if (deps.dbt === undefined) {
      return c.json(
        { code: "invalid_request", message: "queries are not configured", details: [] },
        400,
      );
    }
    if (!serviceTokenOk(deps, c)) {
      return c.json(UNAUTHENTICATED, 401);
    }
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(
        { code: "invalid_request", message: "tenantId and sql are required", details: [] },
        400,
      );
    }
    // A first batch can take minutes to compute, and Bun cuts a request that sends nothing for
    // ten seconds. The export's own deadlines bound it instead.
    liftIdleTimeout(c.env, c.req.raw);
    const body = await exportQuery(
      {
        exec: deps.exec,
        sessions: deps.dbt.sessions,
        ...(deps.turns === undefined ? {} : { turns: deps.turns }),
        ...(deps.stop === undefined ? {} : { stop: deps.stop }),
        ...(deps.log === undefined ? {} : { log: deps.log }),
      },
      parsed.data,
    );
    return new Response(body, { status: 200, headers: { "content-type": CSV_MEDIA_TYPE } });
  });
}

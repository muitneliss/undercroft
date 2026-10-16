/**
 * The query verbs: SQL an author wrote, the schema it can name, and the raw lake's console and
 * search -- each answered as the login its route names (see `services/queryRunner.ts`).
 *
 * Split from `analytics.ts` when the scoped routes arrived (ADR 0142), because eight routes with
 * one shape are one idea: configured, the service token, a body parsed by its contract, one
 * service, its answer as JSON. Every refusal past that is the boundary's (`errors.ts`): 400
 * `query_failed` with Postgres's sentence, 503 `tenant_busy`.
 *
 * WHICH LOGIN IS THE ROUTE'S, never a field's. `/v1/queries/run` and `/schema` answer as the
 * customer's BI login; `/v1/queries/scoped/…` as the scope login of the models the request names,
 * for a reader who reaches only those; `/v1/queries/limited/…` the same, for a scope that also
 * limits rows or columns (ADR 0143) -- a route of its own because a worker older than rules would
 * strip them and answer as a login that reads every row; `/v1/queries/raw/…` as the build login,
 * which reads `raw`;
 * `raw/search/within` searches only the streams it is given. A control plane newer than this
 * worker sends a narrowed read only to the narrowed route, which an older worker does not have
 * and answers 404 -- where a field it did not know would have been stripped, and the read
 * answered as a login that sees more.
 */

import {
  RawSearchRequest,
  RawSearchWithinRequest,
  RunQueryRequest,
  ScopedRunQueryRequest,
  ScopedSchemaRequest,
} from "@undercroft/contracts";
import type { Hono } from "hono";
import {
  type QueryDeps,
  readRawSchema,
  readSchema,
  runQuery,
  runRawQuery,
} from "../services/queryRunner.ts";
import { searchRaw } from "../services/rawSearch.ts";
import { UNAUTHENTICATED, serviceTokenOk } from "./bearer.ts";
import type { LakeApiDeps } from "./lake.ts";

/** A body that names a tenant and nothing else: the schema reads. */
const TenantOnly = ScopedSchemaRequest.omit({ scope: true });

/** A contract that parses a body, whatever it parses it into. */
interface Parses<T> {
  safeParse: (raw: unknown) => { success: true; data: T } | { success: false };
}

/** One query route: `answer` the body `schema` parses, or say what the body must name. */
function queryRoute<T>(
  app: Hono,
  deps: LakeApiDeps,
  shape: { path: string; schema: Parses<T>; requires: string },
  answer: (on: QueryDeps, input: T) => Promise<object>,
): void {
  app.post(shape.path, async (c) => {
    if (deps.dbt === undefined) {
      return c.json(
        { code: "invalid_request", message: "queries are not configured", details: [] },
        400,
      );
    }
    if (!serviceTokenOk(deps, c)) {
      return c.json(UNAUTHENTICATED, 401);
    }
    const parsed = shape.schema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ code: "invalid_request", message: shape.requires, details: [] }, 400);
    }
    const answered: object = await answer(
      { exec: deps.exec, sessions: deps.dbt.sessions },
      parsed.data,
    );
    return c.json(answered, 200);
  });
}

/** One route, ready to register: its path, the contract its body is parsed by, and its service. */
type Registration = (app: Hono, deps: LakeApiDeps) => void;

function route<T>(
  path: string,
  schema: Parses<T>,
  requires: string,
  answer: (on: QueryDeps, input: T) => Promise<object>,
): Registration {
  return (app, deps) => {
    queryRoute(app, deps, { path, schema, requires }, answer);
  };
}

const SQL = "tenantId and sql are required";
const TENANT = "tenantId is required";

/**
 * Every query route, by the login it answers as. The scoped and limited four answer as the scope
 * login of the models and rules the request names; the raw four as the build login, which the control plane admits only
 * a reader of the whole lake to -- or, for `within`, searches only the streams it is given.
 */
const QUERY_ROUTES: readonly Registration[] = [
  route("/v1/queries/run", RunQueryRequest, SQL, runQuery),
  route("/v1/queries/scoped/run", ScopedRunQueryRequest, `${SQL}, with a scope`, runQuery),
  route("/v1/queries/schema", TenantOnly, TENANT, readSchema),
  route("/v1/queries/scoped/schema", ScopedSchemaRequest, `${TENANT}, with a scope`, readSchema),
  route("/v1/queries/limited/run", ScopedRunQueryRequest, `${SQL}, with a scope`, runQuery),
  route("/v1/queries/limited/schema", ScopedSchemaRequest, `${TENANT}, with a scope`, readSchema),
  route("/v1/queries/raw/run", RunQueryRequest, SQL, runRawQuery),
  route("/v1/queries/raw/schema", TenantOnly, TENANT, readRawSchema),
  route("/v1/queries/raw/search", RawSearchRequest, "tenantId and q are required", searchRaw),
  route(
    "/v1/queries/raw/search/within",
    RawSearchWithinRequest,
    "tenantId, q and streams are required",
    searchRaw,
  ),
];

export function registerQueryRoutes(app: Hono, deps: LakeApiDeps): void {
  for (const register of QUERY_ROUTES) {
    register(app, deps);
  }
}

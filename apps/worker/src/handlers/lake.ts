/**
 * The lake write API: how anything that is not the connector runtime lands data.
 *
 * Plain REST, because the callers are Kestra, shell scripts and third-party tools, not
 * TypeScript clients. The request and response shapes come from `@undercroft/contracts`,
 * the same Zod schemas any generated OpenAPI document would use, so there is one
 * definition and no hand-written second copy to drift.
 */

import {
  BrowseScopeRequest,
  BuildModelRequest,
  DqFailuresRequest,
  LandRecordsRequest,
  MAX_BATCH_BYTES,
  RevokeConnectionRequest,
  RunQueryRequest,
  StoreCredentialRequest,
} from "@undercroft/contracts";
import type { Fetcher } from "@undercroft/connector-runtime";
import {
  type ByteFetcher,
  createByteFetcher,
  describeError,
  type Logger,
  newRequestId,
} from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";
import type { LakeStore } from "@undercroft/lake";
import { type Context, Hono } from "hono";
import { authenticate } from "../services/auth.ts";
import {
  browseScope,
  revokeConnection,
  storeCredential,
  type XeroClient,
} from "../services/connections.ts";
import { type Refresher, resolveToken, type Transactor } from "../services/ingest.ts";
import {
  buildModel,
  dqFailures,
  type JobDeps,
  startIngestJob,
  startTransformJob,
} from "../services/jobs.ts";
import { landRecords } from "../services/land.ts";
import { claimExternal, findRun, recordExternal } from "../services/ledger.ts";
import { readSchema, runQuery } from "../services/queryRunner.ts";
import { listDue } from "../services/schedule.ts";
import type { TransformDeps } from "../services/transform.ts";
import { failureOf } from "./errors.ts";

export interface LakeApiDeps {
  readonly lake: LakeStore;
  readonly exec: SqlExecutor;
  readonly serviceToken: string;
  /**
   * Where a request line and a failure go. Absent means silence, which is what a test that
   * is not about logging wants; the process always wires one.
   */
  readonly log?: Logger;
  /** Directory of connector specs, for the ingest verb. Absent disables /v1/runs/ingest. */
  readonly specsDir?: string;
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Per-source token refreshers. A source with no entry cannot refresh -- correct for a
   * HubSpot private app, which has nothing to refresh with.
   */
  readonly refreshers?: Readonly<Record<string, Refresher>>;
  /**
   * Runs the credential read and its refresh in one transaction, so the `FOR UPDATE` in
   * `accessToken` actually holds a lock. See `services/ingest.ts`.
   */
  readonly transactor?: Transactor;
  /** The byte seam for the Google verbs. Injected in tests; the process wires the real one. */
  readonly byteFetcher?: ByteFetcher;
  /** The text seam for the spec-driven ingest verb. Injected in tests, as above. */
  readonly fetcher?: Fetcher;
  /**
   * How a tenant's models are built: where dbt should point, how the worker becomes the
   * tenant, and the spawn seam. Absent disables the transform, build and dq verbs.
   */
  readonly dbt?: Omit<TransformDeps, "exec">;
  /** The Xero client, for revoking a grant. Absent means a disconnect only forgets our copy. */
  readonly xero?: XeroClient;
}

const BEARER = /^Bearer\s+(?<token>.+)$/iu;

function bearerOf(header: string | undefined): string | null {
  if (header === undefined) {
    return null;
  }
  const match = BEARER.exec(header);
  return match?.groups?.token ?? null;
}

export function createLakeApi(deps: LakeApiDeps): Hono {
  const app = new Hono();

  /**
   * One line per request, and an id the caller can quote back.
   *
   * Method, path, status and duration -- never a body. The body of a credential verb
   * carries a live refresh token and the body of a records verb carries source payloads,
   * and a request log is a far less controlled surface than the tables those belong in.
   * The id is set before the handler runs so it rides on the response whichever way the
   * request ends, including through the error boundary below.
   */
  app.use("*", async (c, next) => {
    const requestId = newRequestId();
    const startedAt = Date.now();
    c.header("x-request-id", requestId);
    await next();
    deps.log?.info("request", {
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - startedAt,
    });
  });

  /**
   * The one error boundary. Every verb below lets a failure raise -- a refused scope, a
   * dead credential, a source mid-fault -- and this is where each becomes the status and
   * code the caller acts on. `failureOf` holds the mapping; this holds only the transport.
   */
  app.onError((error, c) => {
    const failure = failureOf(error);
    deps.log?.error("request_failed", {
      method: c.req.method,
      path: c.req.path,
      status: failure.status,
      code: failure.code,
      ...describeError(error),
    });
    return c.json(
      { code: failure.code, message: failure.message, details: failure.details },
      failure.status,
    );
  });

  app.get("/health", (c) => c.json({ ok: true }));

  app.post("/v1/lake/records", async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = LandRecordsRequest.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        {
          code: "invalid_request",
          message: "request did not match the lake records schema",
          details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        },
        400,
      );
    }
    const body = parsed.data;

    // Size ceiling on the decoded text. A batch larger than this makes more calls.
    const bytes = body.records.reduce((sum, r) => sum + r.payloadText.length, 0);
    if (bytes > MAX_BATCH_BYTES) {
      return c.json(
        { code: "payload_too_large", message: "batch exceeds the size limit", details: [] },
        413,
      );
    }

    const auth = await authenticate(deps.exec, bearerOf(c.req.header("authorization")), {
      serviceToken: deps.serviceToken,
      tenantId: body.tenantId,
      source: body.source,
    });
    if (!auth.ok) {
      return c.json(
        { code: auth.code, message: auth.message, details: [] },
        auth.code === "unauthenticated" ? 401 : 403,
      );
    }

    // The caller's run id is claimed BEFORE anything is landed. A script posts batches under
    // an id of its own choosing, and an id that already names another tenant's run must be
    // refused rather than merged into it.
    const claimed = await claimExternal(deps.exec, {
      runId: body.runId,
      tenantId: body.tenantId,
      source: body.source,
    });
    if (!claimed) {
      return c.json(
        {
          code: "invalid_request",
          message: "runId already belongs to a run for another tenant or source",
          details: [],
        },
        400,
      );
    }

    const result = await landRecords(deps.lake, {
      source: body.source,
      tenantId: body.tenantId,
      runId: body.runId,
      reason: body.reason,
      records: body.records,
    });
    await recordExternal(deps.exec, body.runId, result);

    // If any record failed, the response is 422 -- never a 200 with a failed count, which
    // a caller checking only the status code would read as success.
    const status = result.failed > 0 ? 422 : 200;
    return c.json({ runId: body.runId, ...result }, status);
  });

  /** The run deps for one source, with that source's refresher if it has one. */
  function jobDeps(source: string, specsDir: string): JobDeps {
    const refresher = deps.refreshers?.[source];
    return {
      lake: deps.lake,
      exec: deps.exec,
      specsDir,
      ...(deps.log === undefined ? {} : { log: deps.log }),
      ...(deps.env ? { env: deps.env } : {}),
      ...(refresher === undefined ? {} : { refresher }),
      ...(deps.transactor === undefined ? {} : { transactor: deps.transactor }),
      ...(deps.fetcher === undefined ? {} : { fetcher: deps.fetcher }),
      ...(deps.dbt === undefined ? {} : { dbt: { ...deps.dbt, exec: deps.exec } }),
    };
  }

  /**
   * The trigger allowlist. Kestra and the control plane can start exactly these verbs, with
   * the service token, and nothing else.
   *
   * Both answer 202 with the run's id and carry on without the caller: a full slice is
   * minutes, and an open HTTP connection is not the place to hold one. What refuses, refuses
   * before a row is opened -- an unknown tenant is 404, a source with no usable grant and a
   * run already in progress are 409 -- through the error boundary above. The ledger is the
   * record of what happened after 202; `GET /v1/runs/:id` reads it.
   */
  app.post("/v1/runs/ingest", async (c) => {
    if (deps.specsDir === undefined) {
      return c.json(
        { code: "invalid_request", message: "ingest is not configured", details: [] },
        400,
      );
    }
    if (!serviceTokenOk(c)) {
      return c.json(unauthenticated, 401);
    }
    const raw = (await c.req.json().catch(() => ({}))) as {
      source?: unknown;
      tenantId?: unknown;
      trigger?: unknown;
      triggeredBy?: unknown;
      chain?: unknown;
    };
    if (typeof raw.source !== "string" || typeof raw.tenantId !== "string") {
      return c.json(
        { code: "invalid_request", message: "source and tenantId are required", details: [] },
        400,
      );
    }
    const started = await startIngestJob(jobDeps(raw.source, deps.specsDir), {
      source: raw.source,
      tenantId: raw.tenantId,
      trigger: raw.trigger === "manual" ? "manual" : "schedule",
      triggeredBy: typeof raw.triggeredBy === "string" ? raw.triggeredBy : "",
      chain: raw.chain !== false,
    });
    return c.json(started, 202);
  });

  app.post("/v1/runs/transform", async (c) => {
    if (deps.dbt === undefined) {
      return c.json(
        { code: "invalid_request", message: "transform is not configured", details: [] },
        400,
      );
    }
    if (!serviceTokenOk(c)) {
      return c.json(unauthenticated, 401);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      tenantId?: unknown;
      select?: unknown;
      trigger?: unknown;
      triggeredBy?: unknown;
    };
    if (typeof body.tenantId !== "string") {
      return c.json({ code: "invalid_request", message: "tenantId is required", details: [] }, 400);
    }
    const started = await startTransformJob(jobDeps("*", deps.specsDir ?? ""), {
      tenantId: body.tenantId,
      trigger: body.trigger === "manual" ? "manual" : "schedule",
      triggeredBy: typeof body.triggeredBy === "string" ? body.triggeredBy : "",
      ...(typeof body.select === "string" ? { select: body.select } : {}),
    });
    return c.json(started, 202);
  });

  /**
   * Build one model and answer with what it did and its first rows. Synchronous, unlike
   * the two verbs above: the person who pressed Build is looking at the editor, and a run
   * id they would have to poll is a worse answer than the rows. Bounded by the build's own
   * deadline. A build already in progress for the tenant is 409 through the boundary.
   */
  app.post("/v1/models/build", async (c) => {
    if (deps.dbt === undefined) {
      return c.json(
        { code: "invalid_request", message: "transform is not configured", details: [] },
        400,
      );
    }
    if (!serviceTokenOk(c)) {
      return c.json(unauthenticated, 401);
    }
    const parsed = BuildModelRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(
        { code: "invalid_request", message: "tenantId and model are required", details: [] },
        400,
      );
    }
    const built = await buildModel(jobDeps("*", deps.specsDir ?? ""), parsed.data);
    return c.json(built, 200);
  });

  /** The rows a failed test stored, for the admin who is looking at the step. */
  app.post("/v1/dq/failures", async (c) => {
    if (deps.dbt === undefined) {
      return c.json(
        { code: "invalid_request", message: "transform is not configured", details: [] },
        400,
      );
    }
    if (!serviceTokenOk(c)) {
      return c.json(unauthenticated, 401);
    }
    const parsed = DqFailuresRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(
        {
          code: "invalid_request",
          message: "tenantId, runId and uniqueId are required",
          details: [],
        },
        400,
      );
    }
    const outcome = await dqFailures(jobDeps("*", deps.specsDir ?? ""), parsed.data);
    if (!outcome.ok) {
      if (outcome.reason === "not-dq") {
        return c.json(
          { code: "invalid_request", message: "the step stored no failing rows", details: [] },
          400,
        );
      }
      return c.json({ code: "not_found", message: "no such step", details: [] }, 404);
    }
    return c.json(outcome.value, 200);
  });

  /**
   * Run SQL an author wrote, as the tenant's read-only login. The frame around it is in
   * `repos/queries.ts`; a query that did not run is 400 `query_failed` with Postgres's own
   * sentence, through the boundary.
   */
  app.post("/v1/queries/run", async (c) => {
    if (deps.dbt === undefined) {
      return c.json(
        { code: "invalid_request", message: "queries are not configured", details: [] },
        400,
      );
    }
    if (!serviceTokenOk(c)) {
      return c.json(unauthenticated, 401);
    }
    const parsed = RunQueryRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(
        { code: "invalid_request", message: "tenantId and sql are required", details: [] },
        400,
      );
    }
    const result = await runQuery({ exec: deps.exec, sessions: deps.dbt.sessions }, parsed.data);
    return c.json(result, 200);
  });

  /** The tenant's analytics schema as its read-only login sees it. */
  app.post("/v1/queries/schema", async (c) => {
    if (deps.dbt === undefined) {
      return c.json(
        { code: "invalid_request", message: "queries are not configured", details: [] },
        400,
      );
    }
    if (!serviceTokenOk(c)) {
      return c.json(unauthenticated, 401);
    }
    const body = (await c.req.json().catch(() => ({}))) as { tenantId?: unknown };
    if (typeof body.tenantId !== "string" || body.tenantId === "") {
      return c.json({ code: "invalid_request", message: "tenantId is required", details: [] }, 400);
    }
    const schema = await readSchema(
      { exec: deps.exec, sessions: deps.dbt.sessions },
      { tenantId: body.tenantId },
    );
    return c.json(schema, 200);
  });

  /**
   * What the scheduler should start now. Registered before `/v1/runs/:id` so that `due` is
   * a word and not a run id.
   */
  app.get("/v1/runs/due", async (c) => {
    if (!serviceTokenOk(c)) {
      return c.json(unauthenticated, 401);
    }
    return c.json({ due: await listDue(deps.exec) }, 200);
  });

  /** One run, by id, for whoever started it. The control plane reads the ledger directly. */
  app.get("/v1/runs/:id", async (c) => {
    if (!serviceTokenOk(c)) {
      return c.json(unauthenticated, 401);
    }
    const run = await findRun(deps.exec, c.req.param("id"));
    if (run === null) {
      return c.json({ code: "not_found", message: "no such run", details: [] }, 404);
    }
    return c.json(run, 200);
  });

  /**
   * The connection verbs, for the control plane's OAuth flow.
   *
   * **Service token only, deliberately.** `authenticate()` is not called here, unlike
   * `/v1/lake/records`: an ingest key is a per-tenant grant to LAND data, and accepting one
   * to mint or destroy a credential would quietly widen every key ever issued into a
   * credential-management capability.
   */
  function serviceTokenOk(c: Context): boolean {
    return (
      deps.serviceToken !== "" && bearerOf(c.req.header("authorization")) === deps.serviceToken
    );
  }

  const unauthenticated = {
    code: "unauthenticated",
    message: "the trigger token is required",
    details: [],
  };

  app.post("/v1/connections/credential", async (c) => {
    if (!serviceTokenOk(c)) {
      return c.json(unauthenticated, 401);
    }

    const parsed = StoreCredentialRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(
        {
          code: "invalid_request",
          message: "request did not match the store credential schema",
          // The issue paths, never the values: this body carries a live refresh token.
          details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        },
        400,
      );
    }

    const outcome = await storeCredential(
      {
        exec: deps.exec,
        ...(deps.transactor === undefined ? {} : { transactor: deps.transactor }),
        ...(deps.env === undefined ? {} : { env: deps.env }),
        ...(deps.byteFetcher === undefined ? {} : { fetcher: deps.byteFetcher }),
      },
      parsed.data,
    );
    if (!outcome.ok) {
      // Three refusals, three statuses, because the remedies differ: a tenant that does not
      // exist, a token the provider turned away (422: the body was well-formed and wrong),
      // and a source nobody can probe.
      if (outcome.reason === "credential-rejected") {
        return c.json(
          {
            code: "credential_rejected",
            message: "the provider refused this credential",
            details: [],
          },
          422,
        );
      }
      if (outcome.reason === "cannot-validate") {
        return c.json(
          {
            code: "invalid_request",
            message: `${parsed.data.source} cannot be validated`,
            details: [],
          },
          400,
        );
      }
      return c.json({ code: "invalid_request", message: "unknown tenant", details: [] }, 404);
    }
    return c.json(
      {
        tenantId: parsed.data.tenantId,
        source: parsed.data.source,
        status: "connected",
        expiresAt: outcome.expiresAt,
      },
      200,
    );
  });

  app.post("/v1/connections/browse", async (c) => {
    if (!serviceTokenOk(c)) {
      return c.json(unauthenticated, 401);
    }

    const parsed = BrowseScopeRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(
        { code: "invalid_request", message: "source, tenantId and kind are required", details: [] },
        400,
      );
    }

    const outcome = await browseScope(
      {
        exec: deps.exec,
        fetcher: deps.byteFetcher ?? createByteFetcher(),
        token: () => tokenFor(deps, parsed.data),
      },
      parsed.data,
    );
    if (!outcome.ok) {
      // Two refusals, two codes, because the remedies have nothing in common. A source
      // that cannot be browsed is a request this build will never serve; a credential
      // Google refused is one reconnect away from working, and the caller can only say so
      // if the status tells it apart from every other 400 this endpoint can answer.
      if (outcome.reason === "scope-insufficient") {
        return c.json(
          {
            code: "scope_insufficient",
            message: `the ${parsed.data.source} grant does not permit this`,
            details: [],
          },
          403,
        );
      }
      return c.json(
        {
          code: "invalid_request",
          message: `${parsed.data.source} cannot be browsed`,
          details: [],
        },
        400,
      );
    }
    return c.json({ items: outcome.items }, 200);
  });

  app.post("/v1/connections/revoke", async (c) => {
    if (!serviceTokenOk(c)) {
      return c.json(unauthenticated, 401);
    }

    const parsed = RevokeConnectionRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(
        { code: "invalid_request", message: "source and tenantId are required", details: [] },
        400,
      );
    }

    const result = await revokeConnection(
      {
        exec: deps.exec,
        fetcher: deps.byteFetcher ?? createByteFetcher(),
        token: () => tokenFor(deps, parsed.data),
        ...(deps.xero === undefined ? {} : { xero: deps.xero }),
        ...(deps.env === undefined ? {} : { env: deps.env }),
      },
      parsed.data,
    );
    return c.json(result, 200);
  });

  return app;
}

/** The access token for a connection, refreshing under a lock if one is due. */
function tokenFor(deps: LakeApiDeps, input: { source: string; tenantId: string }): Promise<string> {
  return resolveToken(
    {
      exec: deps.exec,
      ...(deps.env === undefined ? {} : { env: deps.env }),
      ...(deps.refreshers?.[input.source] === undefined
        ? {}
        : { refresher: deps.refreshers[input.source] }),
      ...(deps.transactor === undefined ? {} : { transactor: deps.transactor }),
    },
    input,
  );
}

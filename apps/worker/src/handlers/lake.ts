/**
 * The lake write API: how anything that is not the connector runtime lands data.
 *
 * Plain REST, because the callers are Kestra, shell scripts and third-party tools, not
 * TypeScript clients. The request and response shapes come from `@undercroft/contracts`,
 * the same Zod schemas any generated OpenAPI document would use, so there is one
 * definition and no hand-written second copy to drift.
 */

import { LandRecordsRequest, MAX_BATCH_BYTES } from "@undercroft/contracts";
import type { Fetcher } from "@undercroft/connector-runtime";
import { type ByteFetcher, describeError, type Logger } from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";
import type { LakeStore } from "@undercroft/lake";
import { annotate, currentTraceId, traceRequests } from "@undercroft/telemetry";
import { type Context, Hono } from "hono";
import { UNAUTHENTICATED, bearerOf, jobDepsFor, serviceTokenOk } from "./bearer.ts";
import { registerAnalyticsRoutes } from "./analytics.ts";
import { registerConnectionRoutes } from "./connections.ts";
import { authenticate } from "../services/auth.ts";
import type { XeroClient } from "../services/connections.ts";
import type { Refresher, Transactor } from "../services/runTypes.ts";
import { startExtractJob } from "../services/extract/job.ts";
import { startIngestJob, startTransformJob } from "../services/jobs.ts";
import { landRecords } from "../services/land.ts";
import { claimExternal, recordExternal } from "../services/ledger.ts";
import type { Spawn, TransformDeps } from "../services/transform.ts";
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
  /** Which build opens the runs this API starts. See `RunDeps.releaseTag`. */
  readonly releaseTag?: string;
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
  /**
   * How a document's bytes are handed to a reader -- poppler and tesseract out of the worker
   * image. Absent disables the extract verb, exactly as an absent `dbt` disables transform.
   */
  readonly extractSpawn?: Spawn;
  /** The Xero client, for revoking a grant. Absent means a disconnect only forgets our copy. */
  readonly xero?: XeroClient;
  /** Aborted when the process is stopping; handed to every run this API starts. `RunDeps.stop`. */
  readonly stop?: AbortSignal;
}

/** Sent by the Kestra flows with `{{ execution.id }}`, so a failed execution leads to its trace. */
const KESTRA_EXECUTION_HEADER = "x-kestra-execution-id";

export function createLakeApi(deps: LakeApiDeps): Hono {
  const app = new Hono();

  /**
   * One trace per request, one line per request, and an id the caller can quote back.
   *
   * Method, path, status and duration -- never a body. The body of a credential verb
   * carries a live refresh token and the body of a records verb carries source payloads,
   * and a request log is a far less controlled surface than the tables those belong in.
   *
   * The id is the request's trace id (ADR 0058): `x-trace-id`, and `x-request-id` for the
   * lake API's callers who already read that header -- one id under two names, not two ids.
   * Both are set before the handler runs, so they ride on the response whichever way the
   * request ends, including through the error boundary below. A Kestra execution names
   * itself in a header, and the trace is tagged with it so a failed execution leads here.
   */
  app.use("*", traceRequests());
  app.use("*", async (c, next) => {
    const requestId = currentTraceId() ?? "";
    const startedAt = Date.now();
    c.header("x-request-id", requestId);
    const execution = c.req.header(KESTRA_EXECUTION_HEADER);
    if (execution !== undefined) {
      annotate({ "kestra.execution_id": execution });
    }
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

  registerLakeRecordsRoute(app, deps);
  registerRunRoutes(app, deps);

  registerAnalyticsRoutes(app, deps);

  registerConnectionRoutes(app, deps);

  return app;
}

/**
 * Read a batch off the wire, or say why it cannot be read.
 *
 * Two refusals, and they are different: a body that does not match the schema is a 400, and
 * one that is simply too large is a 413 telling the caller to make more calls. Both are
 * answered before the credential is even looked at, because neither depends on who is asking.
 */
type LandRecordsBody = ReturnType<typeof LandRecordsRequest.parse>;

async function admitBatch(
  c: Context,
): Promise<{ ok: true; body: LandRecordsBody } | { ok: false; response: Response }> {
  const raw = await c.req.json().catch(() => null);
  const parsed = LandRecordsRequest.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: c.json(
        {
          code: "invalid_request",
          message: "request did not match the lake records schema",
          details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        },
        400,
      ),
    };
  }

  // Size ceiling on the decoded text. A batch larger than this makes more calls.
  const bytes = parsed.data.records.reduce((sum, r) => sum + r.payloadText.length, 0);
  if (bytes > MAX_BATCH_BYTES) {
    return {
      ok: false,
      response: c.json(
        { code: "payload_too_large", message: "batch exceeds the size limit", details: [] },
        413,
      ),
    };
  }

  return { ok: true, body: parsed.data };
}

function registerLakeRecordsRoute(app: Hono, deps: LakeApiDeps): void {
  app.post("/v1/lake/records", async (c) => {
    const admitted = await admitBatch(c);
    if (!admitted.ok) {
      return admitted.response;
    }
    const { body } = admitted;

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
}

/**
 * The extract verb: read what the landed documents say.
 *
 * Its own registrar because `registerRunRoutes` is at its line ceiling, and because this
 * verb takes no `chain` and no spec directory -- the shape differs enough that folding it in
 * would need a comment explaining which arguments do not apply to which route.
 */
function registerExtractRoute(app: Hono, deps: LakeApiDeps): void {
  app.post("/v1/runs/extract", async (c) => {
    if (deps.extractSpawn === undefined) {
      return c.json(
        { code: "invalid_request", message: "extract is not configured", details: [] },
        400,
      );
    }
    if (!serviceTokenOk(deps, c)) {
      return c.json(UNAUTHENTICATED, 401);
    }
    const raw = (await c.req.json().catch(() => ({}))) as {
      source?: unknown;
      tenantId?: unknown;
      trigger?: unknown;
      triggeredBy?: unknown;
    };
    if (typeof raw.source !== "string" || typeof raw.tenantId !== "string") {
      return c.json(
        { code: "invalid_request", message: "source and tenantId are required", details: [] },
        400,
      );
    }
    const started = await startExtractJob(jobDepsFor(deps, raw.source, deps.specsDir ?? ""), {
      source: raw.source,
      tenantId: raw.tenantId,
      trigger: raw.trigger === "manual" ? "manual" : "schedule",
      triggeredBy: typeof raw.triggeredBy === "string" ? raw.triggeredBy : "",
    });
    return c.json(started, 202);
  });
}

/**
 * The trigger allowlist. Kestra and the control plane can start exactly these verbs, with
 * the service token, and nothing else.
 */
function registerRunRoutes(app: Hono, deps: LakeApiDeps): void {
  app.post("/v1/runs/ingest", async (c) => {
    if (deps.specsDir === undefined) {
      return c.json(
        { code: "invalid_request", message: "ingest is not configured", details: [] },
        400,
      );
    }
    if (!serviceTokenOk(deps, c)) {
      return c.json(UNAUTHENTICATED, 401);
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
    const started = await startIngestJob(jobDepsFor(deps, raw.source, deps.specsDir), {
      source: raw.source,
      tenantId: raw.tenantId,
      trigger: raw.trigger === "manual" ? "manual" : "schedule",
      triggeredBy: typeof raw.triggeredBy === "string" ? raw.triggeredBy : "",
      chain: raw.chain !== false,
    });
    return c.json(started, 202);
  });

  registerExtractRoute(app, deps);

  app.post("/v1/runs/transform", async (c) => {
    if (deps.dbt === undefined) {
      return c.json(
        { code: "invalid_request", message: "transform is not configured", details: [] },
        400,
      );
    }
    if (!serviceTokenOk(deps, c)) {
      return c.json(UNAUTHENTICATED, 401);
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
    const started = await startTransformJob(jobDepsFor(deps, "*", deps.specsDir ?? ""), {
      tenantId: body.tenantId,
      trigger: body.trigger === "manual" ? "manual" : "schedule",
      triggeredBy: typeof body.triggeredBy === "string" ? body.triggeredBy : "",
      ...(typeof body.select === "string" ? { select: body.select } : {}),
    });
    return c.json(started, 202);
  });
}

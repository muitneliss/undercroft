/**
 * The verbs behind a dashboard: build a model, preview one before it is saved, drop what it built
 * (`drops.ts`), read its test failures, run a question, read a schema, and the run ledger the
 * Journal pages.
 *
 * Split from `lake.ts` because they are the READ side of the platform -- everything here
 * answers a question about what is already landed, and nothing here lands anything.
 */

import {
  BuildModelRequest,
  buildSelection,
  DqFailuresRequest,
  PreviewModelRequest,
  RawSearchRequest,
  RunQueryRequest,
} from "@undercroft/contracts";
import { liftIdleTimeout } from "@undercroft/core";
import type { Hono } from "hono";
import { buildModels, dqFailures, startBuildJob } from "../services/jobs.ts";
import { findRun } from "../services/ledger.ts";
import { PREVIEW_DEADLINE_MS, previewModel } from "../services/modelPreview.ts";
import { readRawSchema, readSchema, runQuery, runRawQuery } from "../services/queryRunner.ts";
import { searchRaw } from "../services/rawSearch.ts";
import { listDue, listExtractDue } from "../services/schedule.ts";
import { UNAUTHENTICATED, jobDepsFor, serviceTokenOk } from "./bearer.ts";
import { registerDropRoutes } from "./drops.ts";
import { answerDue } from "./due.ts";
import { registerExportRoute } from "./exports.ts";
import type { LakeApiDeps } from "./lake.ts";
import { registerSemanticRoutes } from "./semantic.ts";

const MS_PER_SECOND = 1000;

export function registerAnalyticsRoutes(app: Hono, deps: LakeApiDeps): void {
  /**
   * Build some models and answer with what they did, their row counts and the one model's first
   * rows. Synchronous by default, unlike the two verbs above: the person who pressed Build is
   * looking at the editor, and a run id they would have to poll is a worse answer than the rows.
   * Bounded by the build's own deadline. With `wait: false` it answers 202 with the run as soon
   * as the run is open, for an agent that waits on the run instead (issue 442). A build already
   * in progress for the tenant is 409 `run_in_progress` naming it, through the boundary.
   */

  /** The rows a failed test stored, for the admin who is looking at the step. */

  /**
   * Run SQL an author wrote, as the tenant's read-only login. The frame around it is in
   * `repos/queries.ts`; a query that did not run is 400 `query_failed` with Postgres's own
   * sentence, through the boundary.
   */

  /** The tenant's analytics schema as its read-only login sees it. */

  /**
   * What the scheduler should start now. Registered before `/v1/runs/:id` so that `due` is
   * a word and not a run id.
   */

  /** One run, by id, for whoever started it. The control plane reads the ledger directly. */
  registerModelsBuildRoute(app, deps);
  registerModelsPreviewRoute(app, deps);
  registerDropRoutes(app, deps);
  registerDqFailuresRoute(app, deps);
  registerQueriesRunRoute(app, deps);
  registerExportRoute(app, deps);
  registerQueriesSchemaRoute(app, deps);
  registerRawQueryRoutes(app, deps);
  registerRunsDueGetRoute(app, deps);
  registerRunsExtractDueGetRoute(app, deps);
  registerSemanticRoutes(app, deps);
  registerRunsGetRoute(app, deps);
}

function registerModelsBuildRoute(app: Hono, deps: LakeApiDeps): void {
  app.post("/v1/models/build", async (c) => {
    if (deps.dbt === undefined) {
      return c.json(
        { code: "invalid_request", message: "transform is not configured", details: [] },
        400,
      );
    }
    if (!serviceTokenOk(deps, c)) {
      return c.json(UNAUTHENTICATED, 401);
    }
    const parsed = BuildModelRequest.safeParse(await c.req.json().catch(() => null));
    const select = parsed.success ? buildSelection(parsed.data) : null;
    if (!parsed.success || select === null) {
      return c.json(
        { code: "invalid_request", message: "tenantId and select are required", details: [] },
        400,
      );
    }
    const jobDeps = jobDepsFor(deps, "*", deps.specsDir ?? "");
    const input = { tenantId: parsed.data.tenantId, select, triggeredBy: parsed.data.triggeredBy };
    if (!parsed.data.wait) {
      return c.json(await startBuildJob(jobDeps, input), 202);
    }
    return c.json(await buildModels(jobDeps, input), 200);
  });
}

/**
 * What an unsaved model returns, compiled by dbt in the tenant's project and run in the read-only
 * frame as its dbt login (ADR 0132). No run, no build lock, nothing stored. A model dbt would not
 * compile is 400 `compile_failed` with dbt's cause, and SQL Postgres refused is 400 `query_failed`
 * with its sentence, both through the boundary. A compile takes seconds, so the request is held
 * open for the preview's own deadline rather than cut at Bun's ten.
 */
function registerModelsPreviewRoute(app: Hono, deps: LakeApiDeps): void {
  app.post("/v1/models/preview", async (c) => {
    if (deps.dbt === undefined) {
      return c.json(
        { code: "invalid_request", message: "transform is not configured", details: [] },
        400,
      );
    }
    if (!serviceTokenOk(deps, c)) {
      return c.json(UNAUTHENTICATED, 401);
    }
    const parsed = PreviewModelRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(
        { code: "invalid_request", message: "tenantId, name and sql are required", details: [] },
        400,
      );
    }
    liftIdleTimeout(c.env, c.req.raw, PREVIEW_DEADLINE_MS / MS_PER_SECOND);
    const preview = await previewModel(
      {
        ...deps.dbt,
        exec: deps.exec,
        ...(deps.turns === undefined ? {} : { turns: deps.turns }),
        ...(deps.stop === undefined ? {} : { stop: deps.stop }),
      },
      parsed.data,
    );
    return c.json(preview, 200);
  });
}

function registerDqFailuresRoute(app: Hono, deps: LakeApiDeps): void {
  app.post("/v1/dq/failures", async (c) => {
    if (deps.dbt === undefined) {
      return c.json(
        { code: "invalid_request", message: "transform is not configured", details: [] },
        400,
      );
    }
    if (!serviceTokenOk(deps, c)) {
      return c.json(UNAUTHENTICATED, 401);
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
    const outcome = await dqFailures(jobDepsFor(deps, "*", deps.specsDir ?? ""), parsed.data);
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
}

function registerQueriesRunRoute(app: Hono, deps: LakeApiDeps): void {
  app.post("/v1/queries/run", async (c) => {
    if (deps.dbt === undefined) {
      return c.json(
        { code: "invalid_request", message: "queries are not configured", details: [] },
        400,
      );
    }
    if (!serviceTokenOk(deps, c)) {
      return c.json(UNAUTHENTICATED, 401);
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
}

function registerQueriesSchemaRoute(app: Hono, deps: LakeApiDeps): void {
  app.post("/v1/queries/schema", async (c) => {
    if (deps.dbt === undefined) {
      return c.json(
        { code: "invalid_request", message: "queries are not configured", details: [] },
        400,
      );
    }
    if (!serviceTokenOk(deps, c)) {
      return c.json(UNAUTHENTICATED, 401);
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
}

/**
 * The raw lake's own console: the same frame, answered as the tenant's dbt login.
 *
 * Separate from `/v1/queries/run` because the login differs, and the login is the boundary:
 * that route answers a dashboard as BI, which cannot see `raw` at all. Both are behind the
 * service token, and the control plane admits only an admin to this one.
 */
function registerRawQueryRoutes(app: Hono, deps: LakeApiDeps): void {
  app.post("/v1/queries/raw/run", async (c) => {
    if (deps.dbt === undefined) {
      return c.json(
        { code: "invalid_request", message: "queries are not configured", details: [] },
        400,
      );
    }
    if (!serviceTokenOk(deps, c)) {
      return c.json(UNAUTHENTICATED, 401);
    }
    const parsed = RunQueryRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(
        { code: "invalid_request", message: "tenantId and sql are required", details: [] },
        400,
      );
    }
    const result = await runRawQuery({ exec: deps.exec, sessions: deps.dbt.sessions }, parsed.data);
    return c.json(result, 200);
  });

  app.post("/v1/queries/raw/schema", async (c) => {
    if (deps.dbt === undefined) {
      return c.json(
        { code: "invalid_request", message: "queries are not configured", details: [] },
        400,
      );
    }
    if (!serviceTokenOk(deps, c)) {
      return c.json(UNAUTHENTICATED, 401);
    }
    const body = (await c.req.json().catch(() => ({}))) as { tenantId?: unknown };
    if (typeof body.tenantId !== "string" || body.tenantId === "") {
      return c.json({ code: "invalid_request", message: "tenantId is required", details: [] }, 400);
    }
    const schema = await readRawSchema(
      { exec: deps.exec, sessions: deps.dbt.sessions },
      { tenantId: body.tenantId },
    );
    return c.json(schema, 200);
  });

  /**
   * One question over the whole of a tenant's raw lake, as that tenant's dbt login.
   *
   * Beside `raw/run` rather than under `/v1/search`, because the login is what these two
   * routes have in common and the login is the boundary. A reader who reached this could have
   * written the equivalent SELECT in the console next to it; what is different is only that
   * they do not have to.
   */
  app.post("/v1/queries/raw/search", async (c) => {
    if (deps.dbt === undefined) {
      return c.json(
        { code: "invalid_request", message: "queries are not configured", details: [] },
        400,
      );
    }
    if (!serviceTokenOk(deps, c)) {
      return c.json(UNAUTHENTICATED, 401);
    }
    const parsed = RawSearchRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(
        { code: "invalid_request", message: "tenantId and q are required", details: [] },
        400,
      );
    }
    const found = await searchRaw({ exec: deps.exec, sessions: deps.dbt.sessions }, parsed.data);
    return c.json(found, 200);
  });
}

function registerRunsDueGetRoute(app: Hono, deps: LakeApiDeps): void {
  app.get("/v1/runs/due", async (c) => {
    if (!serviceTokenOk(deps, c)) {
      return c.json(UNAUTHENTICATED, 401);
    }
    return answerDue(c, deps, "ingest", await listDue(deps.exec));
  });
}

/**
 * Which pairs have documents nobody has read yet.
 *
 * Its own route rather than a flag on `/v1/runs/due`, because the two lists answer different
 * questions and a caller wants one of them: the ingest flow must not start extracts, and the
 * extract flow must not start syncs. Registered before `/v1/runs/:id` for the same reason
 * `due` is -- otherwise `extract-due` is read as a run id.
 */
function registerRunsExtractDueGetRoute(app: Hono, deps: LakeApiDeps): void {
  app.get("/v1/runs/extract-due", async (c) => {
    if (!serviceTokenOk(deps, c)) {
      return c.json(UNAUTHENTICATED, 401);
    }
    return answerDue(c, deps, "extract", await listExtractDue(deps.exec));
  });
}

function registerRunsGetRoute(app: Hono, deps: LakeApiDeps): void {
  app.get("/v1/runs/:id", async (c) => {
    if (!serviceTokenOk(deps, c)) {
      return c.json(UNAUTHENTICATED, 401);
    }
    const run = await findRun(deps.exec, c.req.param("id"));
    if (run === null) {
      return c.json({ code: "not_found", message: "no such run", details: [] }, 404);
    }
    return c.json(run, 200);
  });
}

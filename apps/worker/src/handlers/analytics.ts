/**
 * The verbs behind a dashboard: build a model, preview one before it is saved, drop what it built
 * (`drops.ts`), read its test failures, run a question and read a schema (`queries.ts`), and the
 * run ledger the Journal pages.
 *
 * Split from `lake.ts` because they are the READ side of the platform -- everything here
 * answers a question about what is already landed, and nothing here lands anything.
 */

import {
  BuildModelRequest,
  buildSelection,
  DqFailuresRequest,
  PreviewModelRequest,
} from "@undercroft/contracts";
import { liftIdleTimeout } from "@undercroft/core";
import type { Hono } from "hono";
import { buildModels, dqFailures, startBuildJob } from "../services/jobs.ts";
import { findRun } from "../services/ledger.ts";
import { PREVIEW_DEADLINE_MS, previewModel } from "../services/modelPreview.ts";
import { listDue, listExtractDue } from "../services/schedule.ts";
import { UNAUTHENTICATED, jobDepsFor, serviceTokenOk } from "./bearer.ts";
import { registerDropRoutes } from "./drops.ts";
import { answerDue } from "./due.ts";
import { registerExportRoute } from "./exports.ts";
import type { LakeApiDeps } from "./lake.ts";
import { registerQueryRoutes } from "./queries.ts";
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

  /** SQL an author wrote, the schema it names and the raw console, by login: `queries.ts`. */

  /**
   * What the scheduler should start now. Registered before `/v1/runs/:id` so that `due` is
   * a word and not a run id.
   */

  /** One run, by id, for whoever started it. The control plane reads the ledger directly. */
  registerModelsBuildRoute(app, deps);
  registerModelsPreviewRoute(app, deps);
  registerDropRoutes(app, deps);
  registerDqFailuresRoute(app, deps);
  registerQueryRoutes(app, deps);
  registerExportRoute(app, deps);
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

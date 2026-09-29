/**
 * The semantic verbs over HTTP: what is due, classify a pair, initialise a catalogue. ADR 0085.
 *
 * Their own registrar, as `extract`'s is, because `lake.ts` and `analytics.ts` are at their line
 * ceilings. The same trigger token as every verb Kestra and the control plane may start.
 *
 * NOT CONFIGURED IS SAID, NOT GUESSED. Without the provider's key the two POSTs answer 400 "not
 * configured" and the due list is EMPTY -- so the flow ticks quietly instead of starting runs that
 * could only fail, and the boot log names the missing key.
 */

import { getStringPath } from "@undercroft/core";
import type { Hono } from "hono";

import {
  listSemanticDue,
  startSemanticInitJob,
  startSemanticJob,
} from "../services/semantic/job.ts";
import { jobDepsFor, serviceTokenOk, UNAUTHENTICATED } from "./bearer.ts";
import type { LakeApiDeps } from "./lake.ts";

const NOT_CONFIGURED = {
  code: "invalid_request",
  message: "semantic is not configured",
  details: [],
} as const;

/** Registered before `/v1/runs/:id`, for the reason `extract-due` is. */
export function registerSemanticRoutes(app: Hono, deps: LakeApiDeps): void {
  app.get("/v1/runs/semantic-due", async (c) => {
    if (!serviceTokenOk(deps, c)) {
      return c.json(UNAUTHENTICATED, 401);
    }
    return c.json(
      { due: deps.semanticAsk === undefined ? [] : await listSemanticDue(deps.exec) },
      200,
    );
  });

  app.post("/v1/runs/semantic", async (c) => {
    const { semanticAsk } = deps;
    if (semanticAsk === undefined) {
      return c.json(NOT_CONFIGURED, 400);
    }
    if (!serviceTokenOk(deps, c)) {
      return c.json(UNAUTHENTICATED, 401);
    }
    const body: unknown = await c.req.json().catch(() => null);
    const source = getStringPath(body, "source");
    const tenantId = getStringPath(body, "tenantId");
    if (source === null || tenantId === null) {
      return c.json(
        { code: "invalid_request", message: "source and tenantId are required", details: [] },
        400,
      );
    }
    const started = await startSemanticJob(
      { ...jobDepsFor(deps, source, ""), semanticAsk },
      {
        source,
        tenantId,
        trigger: getStringPath(body, "trigger") === "manual" ? "manual" : "schedule",
        triggeredBy: getStringPath(body, "triggeredBy") ?? "",
      },
    );
    return c.json(started, 202);
  });

  app.post("/v1/runs/semantic-init", async (c) => {
    const { semanticAsk } = deps;
    if (semanticAsk === undefined) {
      return c.json(NOT_CONFIGURED, 400);
    }
    if (!serviceTokenOk(deps, c)) {
      return c.json(UNAUTHENTICATED, 401);
    }
    const body: unknown = await c.req.json().catch(() => null);
    const tenantId = getStringPath(body, "tenantId");
    if (tenantId === null) {
      return c.json({ code: "invalid_request", message: "tenantId is required", details: [] }, 400);
    }
    const started = await startSemanticInitJob(
      { ...jobDepsFor(deps, "*", ""), semanticAsk },
      { tenantId, triggeredBy: getStringPath(body, "triggeredBy") ?? "" },
    );
    if (!started.ok) {
      return c.json(
        {
          code: "catalogue_exists",
          message: "this tenant already has a catalogue; initialising would re-add removed kinds",
          details: [],
        },
        409,
      );
    }
    return c.json({ runId: started.runId }, 202);
  });
}

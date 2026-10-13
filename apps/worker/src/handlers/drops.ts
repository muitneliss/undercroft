/**
 * The two drop verbs: what one model built, or the table one seed's loads made, dropped as the
 * tenant's dbt login before the control plane deletes its row (ADR 0077, ADR 0128).
 *
 * Beside the build route in `analytics.ts`, behind the same service token, and its own module
 * because the two share one contract: 200 with what was dropped -- nothing, for a node never
 * built -- 409 `run_in_progress` while a build of the tenant runs (through the boundary), and 409
 * `relation_depended_on` naming what reads from it; every refusal drops nothing. A seed has its
 * own route rather than a field on the model's, so a worker that predates it answers 404.
 */

import { DropModelRequest, type DropModelResponse, DropSeedRequest } from "@undercroft/contracts";
import type { Context, Hono } from "hono";
import {
  type DropDeps,
  type DropOutcome,
  dropModelRelations,
  dropSeedRelations,
} from "../services/modelDrop.ts";
import { UNAUTHENTICATED, serviceTokenOk } from "./bearer.ts";
import type { LakeApiDeps } from "./lake.ts";

export function registerDropRoutes(app: Hono, deps: LakeApiDeps): void {
  registerDropRoute(app, deps, {
    path: "/v1/models/drop",
    request: DropModelRequest,
    what: "model",
    drop: dropModelRelations,
  });
  registerDropRoute(app, deps, {
    path: "/v1/seeds/drop",
    request: DropSeedRequest,
    what: "seed",
    drop: dropSeedRelations,
  });
}

/** One drop route: configured, authenticated, a body of `request`'s shape, then `drop`. */
function registerDropRoute<Body>(
  app: Hono,
  deps: LakeApiDeps,
  route: {
    path: string;
    /** The contract's schema for the body: anything with zod's `safeParse`. */
    request: {
      safeParse: (value: unknown) => { success: true; data: Body } | { success: false };
    };
    what: "model" | "seed";
    drop: (deps: DropDeps, input: Body) => Promise<DropOutcome>;
  },
): void {
  app.post(route.path, async (c) => {
    if (deps.dbt === undefined) {
      return c.json(
        { code: "invalid_request", message: "transform is not configured", details: [] },
        400,
      );
    }
    if (!serviceTokenOk(deps, c)) {
      return c.json(UNAUTHENTICATED, 401);
    }
    const parsed = route.request.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      const message = `tenantId and ${route.what} are required`;
      return c.json({ code: "invalid_request", message, details: [] }, 400);
    }
    const outcome = await route.drop({ exec: deps.exec, sessions: deps.dbt.sessions }, parsed.data);
    return answerDrop(c, outcome, `other relations read from this ${route.what}`);
  });
}

/** A drop's answer: what went, or 409 `relation_depended_on` naming what reads from it. */
function answerDrop(c: Context, outcome: DropOutcome, refusal: string): Response {
  if (!outcome.ok) {
    return c.json(
      {
        code: "relation_depended_on",
        message: refusal,
        details: outcome.dependents.map((d) => d.name),
      },
      409,
    );
  }
  const body: DropModelResponse = { dropped: outcome.dropped };
  return c.json(body, 200);
}

/**
 * The lake write API: how anything that is not the connector runtime lands data.
 *
 * Plain REST, because the callers are Kestra, shell scripts and third-party tools, not
 * TypeScript clients. The request and response shapes come from `@undercroft/contracts`,
 * the same Zod schemas any generated OpenAPI document would use, so there is one
 * definition and no hand-written second copy to drift.
 */

import { LandRecordsRequest, MAX_BATCH_BYTES } from "@undercroft/contracts";
import type { SqlExecutor } from "@undercroft/db";
import type { LakeStore } from "@undercroft/lake";
import { Hono } from "hono";
import { authenticate } from "../services/auth.ts";
import { runIngest } from "../services/ingest.ts";
import { landRecords } from "../services/land.ts";
import { runTransform } from "../services/transform.ts";

export interface LakeApiDeps {
  readonly lake: LakeStore;
  readonly exec: SqlExecutor;
  readonly serviceToken: string;
  /** Directory of connector specs, for the ingest verb. Absent disables /v1/runs/ingest. */
  readonly specsDir?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** dbt project and profiles directories. Absent disables /v1/runs/transform. */
  readonly dbt?: { projectDir: string; profilesDir: string };
}

function bearerOf(header: string | undefined): string | null {
  if (header === undefined) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/iu.exec(header);
  return match?.[1] ?? null;
}

export function createLakeApi(deps: LakeApiDeps): Hono {
  const app = new Hono();

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

    const result = await landRecords(deps.lake, {
      source: body.source,
      tenantId: body.tenantId,
      runId: body.runId,
      reason: body.reason,
      records: body.records,
    });

    // If any record failed, the response is 422 -- never a 200 with a failed count, which
    // a caller checking only the status code would read as success.
    const status = result.failed > 0 ? 422 : 200;
    return c.json({ runId: body.runId, ...result }, status);
  });

  // The trigger allowlist. Kestra and the control plane can start exactly these verbs,
  // with the service token, and nothing else.
  app.post("/v1/runs/ingest", async (c) => {
    if (deps.specsDir === undefined) {
      return c.json(
        { code: "invalid_request", message: "ingest is not configured", details: [] },
        400,
      );
    }
    const bearer = bearerOf(c.req.header("authorization"));
    if (deps.serviceToken === "" || bearer !== deps.serviceToken) {
      return c.json(
        { code: "unauthenticated", message: "the trigger token is required", details: [] },
        401,
      );
    }
    const raw = (await c.req.json().catch(() => ({}))) as { source?: unknown; tenantId?: unknown };
    if (typeof raw.source !== "string" || typeof raw.tenantId !== "string") {
      return c.json(
        { code: "invalid_request", message: "source and tenantId are required", details: [] },
        400,
      );
    }
    const result = await runIngest(
      {
        lake: deps.lake,
        exec: deps.exec,
        specsDir: deps.specsDir,
        ...(deps.env ? { env: deps.env } : {}),
      },
      { source: raw.source, tenantId: raw.tenantId },
    );
    return c.json(result, 200);
  });

  app.post("/v1/runs/transform", async (c) => {
    if (deps.dbt === undefined) {
      return c.json(
        { code: "invalid_request", message: "transform is not configured", details: [] },
        400,
      );
    }
    const bearer = bearerOf(c.req.header("authorization"));
    if (deps.serviceToken === "" || bearer !== deps.serviceToken) {
      return c.json(
        { code: "unauthenticated", message: "the trigger token is required", details: [] },
        401,
      );
    }
    const body = (await c.req.json().catch(() => ({}))) as { select?: unknown };
    const result = await runTransform(
      deps.dbt,
      typeof body.select === "string" ? { select: body.select } : {},
    );
    return c.json(result, 200);
  });

  return app;
}

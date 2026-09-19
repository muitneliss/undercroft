/**
 * The lake write API: how anything that is not the connector runtime lands data.
 *
 * Plain REST, because the callers are Kestra, shell scripts and third-party tools, not
 * TypeScript clients. The request and response shapes come from `@undercroft/contracts`,
 * the same Zod schemas any generated OpenAPI document would use, so there is one
 * definition and no hand-written second copy to drift.
 */

// biome-ignore-all lint/correctness/useQwikValidLexicalScope: Qwik-domain rule about what may cross a `$()` serialization boundary. There is no Qwik in this repo.

// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: Same functions as noExcessiveLinesPerFunction: one sequential procedure each, whose branches are the states the thing being driven can actually be in.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: These are the functions that hold one decision each -- the connector page loop, the deploy poller, the grant migration -- and the way to shorten them is to split one sequential procedure across several names, which makes the order it happens in harder to follow rather than easier.
// biome-ignore-all lint/nursery/noUnsafeTypeAssertion: Every one of these is a boundary where a payload genuinely is unknown -- a third-party API body, a Docker inspect response, a row shape from a hand-written query -- and is Zod-parsed or checked immediately after. Making the assertions safe means modelling each external shape as a type, which is real work with real value and is not a lint migration.
// biome-ignore-all lint/nursery/useNamedCaptureGroup: These regexes match one thing and read it out of group 1 on the next line. A name helps a pattern with several groups; every one of these has one.
// biome-ignore-all lint/performance/useTopLevelRegex: Worth doing, and not done here: hoisting these 45 literals is a real change to 22 files and belongs in its own commit where the diff is reviewable, not buried in a lint migration. Recorded rather than silently dropped.
// biome-ignore-all lint/style/noExcessiveLinesPerFile: One Hono app, whose routes are registered inside the factory that builds it. Splitting it means either a second factory or route registration happening somewhere a reader of this file cannot see, and the length here counts endpoints rather than complexity in any one of them.
// biome-ignore-all lint/style/noMagicNumbers: What is left after the domain constants were named (see the WCAG block in acetate.ts) is structural: string slice offsets, the radix argument to parseInt, padStart widths, rounding factors. A name like SLICE_START_OF_GREEN_CHANNEL does not tell a reader anything the expression did not. The rule has no allow-list option, so it is per file or not at all.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useExportsLast: Reordering 28 modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. The ordering carries meaning here and the rule's preferred one does not.
// biome-ignore-all lint/suspicious/noUnnecessaryConditions: Checks the inference engine believes are redundant which guard values arriving from outside the type system: a parsed payload, an environment variable, a row from a query. A check the compiler thinks is unnecessary is the one that catches the payload that lied.

import {
  BrowseScopeRequest,
  LandRecordsRequest,
  MAX_BATCH_BYTES,
  RevokeConnectionRequest,
  StoreCredentialRequest,
} from "@undercroft/contracts";
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
import { browseScope, revokeConnection, storeCredential } from "../services/connections.ts";
import { type Refresher, resolveToken, runIngest, type Transactor } from "../services/ingest.ts";
import { landRecords } from "../services/land.ts";
import { claimExternal, recordExternal } from "../services/ledger.ts";
import { runTransform } from "../services/transform.ts";
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
    return c.json({ code: failure.code, message: failure.message, details: [] }, failure.status);
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
    const refresher = deps.refreshers?.[raw.source];
    const result = await runIngest(
      {
        lake: deps.lake,
        exec: deps.exec,
        specsDir: deps.specsDir,
        ...(deps.log === undefined ? {} : { log: deps.log }),
        ...(deps.env ? { env: deps.env } : {}),
        ...(refresher === undefined ? {} : { refresher }),
        ...(deps.transactor === undefined ? {} : { transactor: deps.transactor }),
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
      },
      parsed.data,
    );
    if (!outcome.ok) {
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

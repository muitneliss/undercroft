/**
 * `/mcp`: the router, as model-context tools, for an agent that holds a bearer. ADR 0060.
 *
 * The third door onto the same procedures, after the browser's `/trpc` and the assistant. It
 * owns nothing a procedure means. Every call goes through `appRouter.createCaller(ctx)`, so the
 * role gates, the 404-not-403 boundary, the grant guard and the worded refusals are the
 * router's and cannot drift here. This module is the door itself:
 *
 * - WHO: `Authorization: Bearer` only, resolved by `createContext` at the bearer door. Nobody
 *   there gets a 401 carrying the challenge a model-context client follows to learn how to get
 *   a token -- before any MCP message is read, whatever the method.
 * - WHICH TOOLS, and what each says about itself: `mcpTools.ts`.
 * - WHAT A CALL ANSWERS, result or refusal: `mcpAnswers.ts`.
 * - ONE LOG LINE per call, naming the tool, the credential and the outcome, never the input or
 *   the output -- either may be a customer's data.
 *
 * A FRESH low-level `Server` per request, bound to that request's context, served statelessly.
 * There is no session to hold: the credential is re-read on every request, which is what makes
 * revoking a token take effect at the next call rather than at the end of a connection.
 */

import {
  bearerAuthChallengeResponse,
  type CallToolResult,
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  OAuthError,
  OAuthErrorCode,
  ProtocolError,
  ProtocolErrorCode,
  Server,
} from "@modelcontextprotocol/server";
import { TRPCError } from "@trpc/server";
import { describeError, type Logger } from "@undercroft/core";
import type { Hono } from "hono";
import { messages } from "../i18n/index.ts";
import { answered, refused, refusedBy } from "./mcpAnswers.ts";
import { listTools, toolNamed } from "./mcpTools.ts";
import { resolveProcedure } from "./procedures.ts";
import { appRouter } from "./router.ts";
import { BY_TRPC_CODE, grantAdmits } from "./surface.ts";
import type { Context } from "./trpc.ts";

export interface McpDeps {
  /** The bearer door's context: `createContext(deps, headers, "bearer")`. */
  readonly createContext: (headers: Headers) => Promise<Context>;
  /** `UNDERCROFT_PUBLIC_URL`, whose origin the 401's challenge names. */
  readonly publicUrl?: string;
  /** `UNDERCROFT_RELEASE`, reported as the server's version. */
  readonly release?: string;
  readonly log?: Logger;
}

/**
 * The challenge's description, in ASCII and in no language.
 *
 * A header is a byte string, and a Vietnamese sentence in it is refused by `Headers` outright.
 * This is protocol text beside the `invalid_token` code, read by a client library deciding to
 * start a sign-in -- not a sentence for a person, who is shown their host's own prompt.
 */
const CHALLENGE = "a live personal access token is required as Authorization: Bearer";

/** Long enough for any real tool name; a client's unlisted name is logged no longer than this. */
const LOGGED_NAME_CHARS = 80;

/** One line per call: which tool, whose credential, how it ended. Never the input or output. */
function logCall(
  deps: McpDeps,
  call: { ctx: Context; tool: string; outcome: string; failure?: unknown },
): void {
  const fields = {
    tool: call.tool.slice(0, LOGGED_NAME_CHARS),
    via: call.ctx.via,
    credential: call.ctx.credentialId,
    outcome: call.outcome,
  };
  if (call.failure === undefined) {
    deps.log?.info("mcp_call", fields);
  } else {
    // The error's type, never its message, for the reason `/trpc`'s `onError` gives: exception
    // text routinely embeds the row that caused it. The trace id comes with the logger.
    deps.log?.error("mcp_call", { ...fields, errorType: describeError(call.failure).errorType });
  }
}

/** A call that threw, as its refusal -- logged as a failure when nobody could have prevented it. */
function failed(deps: McpDeps, ctx: Context, tool: string, error: unknown): CallToolResult {
  const known = error instanceof TRPCError ? error : null;
  const outcome = known === null ? "INTERNAL_ERROR" : BY_TRPC_CODE[known.code];
  const internal = outcome === "INTERNAL_ERROR";
  logCall(deps, {
    ctx,
    tool,
    outcome,
    ...(internal ? { failure: known?.cause ?? error } : {}),
  });
  return known === null
    ? refused("INTERNAL_ERROR", messages(ctx.locale)("mcp.refused.INTERNAL_ERROR"))
    : refusedBy(ctx.locale, known);
}

async function callTool(
  deps: McpDeps,
  ctx: Context,
  tool: string,
  args: Record<string, unknown> | undefined,
): Promise<CallToolResult> {
  const t = messages(ctx.locale);
  const spec = await toolNamed(tool);
  if (spec === null) {
    // A name nobody listed is the protocol's own error, per the specification, not a tool's
    // refusal: excluded and session-only procedures land here, as does a typo.
    logCall(deps, { ctx, tool, outcome: "UNKNOWN_TOOL" });
    throw new ProtocolError(ProtocolErrorCode.InvalidParams, t("mcp.unknownTool", { tool }));
  }
  // The grant guard in `trpc.ts` holds regardless; asking first names the refusal the way an
  // agent matches it -- the CLI's `WRITES_DISABLED` -- before any procedure is resolved.
  if (!grantAdmits(ctx.grant, spec.effect)) {
    logCall(deps, { ctx, tool, outcome: "WRITES_DISABLED" });
    return refused("WRITES_DISABLED", t("error.writesDisabled"));
  }
  const procedure = resolveProcedure(appRouter.createCaller(ctx), spec.path);
  if (procedure === null) {
    throw new Error(`${spec.path}: in the manifest but not on the caller`);
  }
  return procedure(args ?? {}).then(
    (result) => {
      logCall(deps, { ctx, tool, outcome: "ok" });
      return answered(ctx.locale, result);
    },
    (error: unknown) => failed(deps, ctx, tool, error),
  );
}

/** The server one request is answered by, bound to that request's caller and nothing else. */
function serverFor(deps: McpDeps, ctx: Context): Server {
  const server = new Server(
    { name: "undercroft", version: deps.release ?? "unreleased" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler("tools/list", async () => ({ tools: await listTools(ctx) }));
  server.setRequestHandler("tools/call", (request) =>
    callTool(deps, ctx, request.params.name, request.params.arguments),
  );
  return server;
}

/**
 * The 401 a model-context client follows: `WWW-Authenticate: Bearer` naming the RFC 9728
 * metadata document for this resource, at the public origin when one is configured.
 */
function challenge(deps: McpDeps, request: Request): Response {
  const { origin } = new URL(deps.publicUrl ?? request.url);
  return bearerAuthChallengeResponse(new OAuthError(OAuthErrorCode.InvalidToken, CHALLENGE), {
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL("/mcp", origin)),
  });
}

/**
 * `/mcp`, every method, and the `/.well-known/` its challenge points into. Both registered
 * before the SPA's catch-all, which would otherwise answer a GET for either with the app shell
 * -- a 200 of HTML that a client reads as a broken server.
 */
export function registerMcpRoute(app: Hono, deps: McpDeps): void {
  app.all("/mcp", async (c) => {
    const ctx = await deps.createContext(c.req.raw.headers);
    if (ctx.user === null) {
      return challenge(deps, c.req.raw);
    }
    const handler = createMcpHandler(() => serverFor(deps, ctx), {
      legacy: "stateless",
      onerror: (error) => {
        deps.log?.warn("mcp_transport", { errorType: describeError(error).errorType });
      },
    });
    try {
      return await handler.fetch(c.req.raw);
    } finally {
      // Nothing outlives the request: no session, no open subscription, no in-flight exchange.
      await handler.close();
    }
  });

  // The metadata document the challenge names is OAuth sign-in for model-context clients, which
  // is ADR 0060's follow-up. Until it is served, asking for it is a 404 -- the honest answer,
  // and one a client handles -- never the app shell.
  app.all("/.well-known/*", (c) => c.notFound());
}

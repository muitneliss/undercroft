/**
 * `/mcp`: the router, as model-context tools, for an agent that holds a bearer. ADR 0060.
 *
 * The third door onto the same procedures, after the browser's `/trpc` and the assistant. It
 * owns nothing a procedure means. Every call goes through `appRouter.createCaller(ctx)`, so the
 * role gates, the 404-not-403 boundary, the grant guard and the worded refusals are the
 * router's and cannot drift here. This module is the door itself:
 *
 * - WHO: `Authorization: Bearer` only -- a personal token, or an OAuth access token from this
 *   control plane's own authorization server (ADR 0061) -- resolved by `bearerContext`. Nobody
 *   there gets the challenge a model-context client follows to learn how to get a token, before
 *   any MCP message is read, whatever the method: a 401, or a 403 naming the scope to ask for.
 * - WHICH TOOLS, and what each says about itself: `mcpTools.ts`.
 * - WHAT A CALL ANSWERS, result or refusal: `mcpAnswers.ts`.
 * - WHICH WIDGET draws an answer, and the widgets themselves as resources: `mcpWidgets.ts`.
 * - THE SKILLS, the repository's own, through the MCP Skills extension: `mcpSkills.ts`.
 * - ONE LOG LINE per call, naming the tool, the credential and the outcome, never the input or
 *   the output -- either may be a customer's data. And one per refused bearer, `mcp_refused`,
 *   naming WHY (ADR 0062): the challenge a client gets is uniform on purpose, so without this
 *   line a client failing at the door leaves nothing to find.
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
import { READ_SCOPE } from "../services/connectedApps.ts";
import type { BearerRefusal, RefusalReason } from "./context.ts";
import { answered, refused, refusedBy } from "./mcpAnswers.ts";
import {
  NO_SKILLS,
  readSkillFile,
  registerSkills,
  type Skill,
  skillCapabilities,
} from "./mcpSkills.ts";
import { listTools, toolNamed } from "./mcpTools.ts";
import { listResources, NO_WIDGETS, readResource, resultMeta, type Widgets } from "./mcpWidgets.ts";
import { resolveProcedure } from "./procedures.ts";
import { appRouter } from "./router.ts";
import { BY_TRPC_CODE, grantAdmits } from "./surface.ts";
import type { Context } from "./trpc.ts";

export interface McpDeps {
  /** The bearer door: this request's context, or why it has none (`bearerContext`). */
  readonly admit: (headers: Headers) => Promise<Context | BearerRefusal>;
  /** `UNDERCROFT_PUBLIC_URL`, whose origin the challenge names. */
  readonly publicUrl?: string;
  /** `UNDERCROFT_RELEASE`, reported as the server's version. */
  readonly release?: string;
  readonly log?: Logger;
  /** The widgets built at boot (`widgets.ts`). Absent or empty: answers are drawn by the host. */
  readonly widgets?: Widgets;
  /** The skills read at boot (`skills.ts`). Absent or empty: the extension is not declared. */
  readonly skills?: readonly Skill[];
}

/**
 * What a client is told about a refusal: RFC 6750's error code, and nothing finer.
 *
 * `invalid_token` covers everything a new token would fix -- none presented, not ours,
 * expired, revoked, its person gone -- and is a 401 whose challenge sends a client to sign in
 * again. `insufficient_scope` is the one case a new token of the SAME kind would not fix: a live
 * OAuth token its person consented to, holding neither `undercroft:read` nor `undercroft:write`.
 * It is a 403 naming the scope to ask for, so a client asks for it instead of looping.
 */
type ChallengeError = "invalid_token" | "insufficient_scope";

/** The one place a refusal's reason is reduced to what the client may learn of it. */
function challengeError(reason: RefusalReason): ChallengeError {
  return reason === "insufficient_scope" ? "insufficient_scope" : "invalid_token";
}

/**
 * The challenges' descriptions, in ASCII and in no language.
 *
 * A header is a byte string, and a Vietnamese sentence in it is refused by `Headers` outright.
 * This is protocol text beside the RFC 6750 code, read by a client library deciding to start a
 * sign-in -- not a sentence for a person, who is shown their host's own prompt.
 */
const CHALLENGES: Readonly<Record<ChallengeError, string>> = {
  invalid_token:
    "a live personal access token, or an access token from this server's authorization " +
    "server, is required as Authorization: Bearer",
  insufficient_scope: `this access token grants neither ${READ_SCOPE} nor its write scope`,
};

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
  const widgets = deps.widgets ?? NO_WIDGETS;
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
      const meta = resultMeta(spec.path, args, widgets);
      return { ...answered(ctx.locale, result), ...(meta === undefined ? {} : { _meta: meta }) };
    },
    (error: unknown) => failed(deps, ctx, tool, error),
  );
}

/**
 * The server one request is answered by, bound to that request's caller and nothing else.
 *
 * It declares `resources` only when there is something to read -- a widget or a skill's file --
 * and the skills extension only when there is a skill, so a host is never told of a capability
 * that answers nothing. `resources/list` lists the widgets alone: a skill's files are found
 * through its manifest, and the extension forbids treating a URI's scheme as what makes a skill.
 */
function serverFor(deps: McpDeps, ctx: Context): Server {
  const widgets = deps.widgets ?? NO_WIDGETS;
  const skills = deps.skills ?? NO_SKILLS;
  const readable = widgets.size > 0 || skills.length > 0;
  const server = new Server(
    { name: "undercroft", version: deps.release ?? "unreleased" },
    {
      capabilities: {
        tools: {},
        ...(readable ? { resources: {} } : {}),
        ...skillCapabilities(skills),
      },
    },
  );
  server.setRequestHandler("tools/list", async () => ({ tools: await listTools(ctx, widgets) }));
  server.setRequestHandler("tools/call", (request) =>
    callTool(deps, ctx, request.params.name, request.params.arguments),
  );
  registerSkills(server, skills, ctx.locale);
  if (readable) {
    server.setRequestHandler("resources/list", () => ({ resources: listResources(widgets) }));
    server.setRequestHandler("resources/read", (request) => {
      const { uri } = request.params;
      const read = readSkillFile(uri, skills) ?? readResource(uri, widgets);
      if (read === null) {
        throw new ProtocolError(
          ProtocolErrorCode.InvalidParams,
          messages(ctx.locale)("mcp.unknownResource", { uri }),
        );
      }
      return read;
    });
  }
  return server;
}

/**
 * What a model-context client follows: `WWW-Authenticate: Bearer` naming the RFC 9728 metadata
 * document for this resource, at the public origin when one is configured. A 401 to go and get
 * a token; a 403 naming `undercroft:read` for a token its person consented to that grants
 * nothing here, so the client asks for the scope rather than for the same token again.
 */
function challenge(deps: McpDeps, request: Request, error: ChallengeError): Response {
  const { origin } = new URL(deps.publicUrl ?? request.url);
  const code =
    error === "insufficient_scope" ? OAuthErrorCode.InsufficientScope : OAuthErrorCode.InvalidToken;
  return bearerAuthChallengeResponse(new OAuthError(code, CHALLENGES[error]), {
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL("/mcp", origin)),
    ...(error === "insufficient_scope" ? { requiredScopes: [READ_SCOPE] } : {}),
  });
}

/**
 * The challenge, and one `mcp_refused` line saying what the challenge does not: the reason, and
 * whose credential it was when that is proven. Never the token. The trace id comes with the
 * logger, and is the `x-trace-id` the refusal answered with, so `task obs:search
 * FOR=status=401` and this line find each other (ADR 0062).
 *
 * `missing` is logged at `info`, everything else at `warn`: a missing bearer is also every
 * OAuth client's first contact -- the challenge IS how it learns to sign in -- and a warning
 * for each would be a warning nobody reads. A token that has died is a client failing.
 */
function refuse(deps: McpDeps, request: Request, refusal: BearerRefusal): Response {
  const error = challengeError(refusal.reason);
  const response = challenge(deps, request, error);
  deps.log?.write(refusal.reason === "missing" ? "info" : "warn", "mcp_refused", {
    status: response.status,
    refusal: error,
    reason: refusal.reason,
    ...(refusal.credentialId === undefined ? {} : { credential: refusal.credentialId }),
  });
  return response;
}

/**
 * `/mcp`, every method. Registered before the SPA's catch-all, which would otherwise answer a
 * GET for it with the app shell -- a 200 of HTML that a client reads as a broken server. The
 * `/.well-known/` documents its challenge points into are `server.ts`'s, served by Better Auth.
 */
export function registerMcpRoute(app: Hono, deps: McpDeps): void {
  app.all("/mcp", async (c) => {
    const ctx = await deps.admit(c.req.raw.headers);
    if ("reason" in ctx) {
      return refuse(deps, c.req.raw, ctx);
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
}

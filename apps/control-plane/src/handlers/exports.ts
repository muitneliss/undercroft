/**
 * `GET /api/exports/:tenantId/:id`: an export, downloaded (ADR 0111).
 *
 * The other half of `bi.exports.create`, which decided everything and answered with this link.
 * Here nothing is decided again by hand: the caller is admitted the way their door admits them,
 * the export is read through `appRouter.createCaller(ctx)` -- so the 404-not-403 boundary, the
 * deactivated tenant, the grant and the role an export needs are the router's, asked now -- and
 * the rows the worker streams are passed on as they arrive.
 *
 * WHICH DOOR. A browser opening the link from a chat carries its session cookie; an agent or
 * the CLI fetching it carries `Authorization: Bearer` or the CLI's own session cookie. A request
 * with an `Authorization` header is admitted by the bearer door and ONLY by it, so a page's
 * cookie cannot lend a session to a bearer that failed; one without is the cookie door's. Either
 * way it is a person's own credential, read on this request, so a revoked token or a signed-out
 * session stops working at the next download as it does at the next call.
 *
 * WHAT A REFUSAL IS. JSON (`{ error: { code, message, traceId } }`) for a caller that asks for
 * JSON, which the CLI does, and a sentence for a browser. The code is the surface's
 * (`BY_TRPC_CODE`), the sentence the router's, or this module's for the two the router keeps
 * unworded on purpose.
 *
 * WHAT A FAILED DOWNLOAD IS. Every refusal is decided before the first byte. After it the worker
 * cuts the body on any failure, and this passes the cut through, so a client is told the
 * download failed rather than handed a file that ended early.
 */

import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import { CSV_MEDIA_TYPE } from "@undercroft/contracts";
import {
  describeError,
  type Locale,
  type Logger,
  liftIdleTimeout,
  negotiateLocale,
} from "@undercroft/core";
import { currentTraceId } from "@undercroft/telemetry";
import type { Hono } from "hono";
import { ZodError } from "zod";
import { messages } from "../i18n/index.ts";
import { recordAction } from "../services/audit.ts";
import { EXPORT_MINUTES, type ExportRow } from "../services/biExports.ts";
import type { BearerRefusal } from "./identity.ts";
import { EXPORT_ROUTE } from "./exportLink.ts";
import { appRouter } from "./router.ts";
import { BY_TRPC_CODE, type SurfaceErrorCode } from "./surface.ts";
import { actorOf, type Context } from "./trpc.ts";

export interface ExportRouteDeps {
  /** This request's caller, through the door its headers choose (see the module docstring). */
  readonly admit: (headers: Headers) => Promise<Context | BearerRefusal>;
  readonly log?: Logger;
}

/** A refusal, as JSON for a caller that asked for JSON and as a sentence for anyone else. */
function refusal(
  accept: string | undefined,
  status: number,
  code: SurfaceErrorCode,
  message: string,
): Response {
  const headers = { "cache-control": "no-store" };
  if (accept?.includes("application/json") === true) {
    return Response.json(
      { error: { code, message, traceId: currentTraceId() } },
      { status, headers },
    );
  }
  return new Response(message, {
    status,
    headers: { ...headers, "content-type": "text/plain;charset=utf-8" },
  });
}

/**
 * A refusal from the router, as this route says it: the rules `mcpAnswers.refusedBy` applies.
 * The two it leaves unworded on purpose get this route's sentences; an internal failure, whose
 * text may hold a row, gets the generic one. An id that is not an id is no such export.
 */
function refusalOf(accept: string | undefined, locale: Locale, error: TRPCError): Response {
  const t = messages(locale);
  if (error.code === "UNAUTHORIZED") {
    return refusal(accept, 401, "AUTHENTICATION_REQUIRED", t("export.signIn"));
  }
  if (error.code === "NOT_FOUND" || error.cause instanceof ZodError) {
    const notFound = t("export.notFound", { minutes: String(EXPORT_MINUTES) });
    return refusal(accept, 404, "NOT_FOUND", notFound);
  }
  const code = BY_TRPC_CODE[error.code];
  const worded = code !== "INTERNAL_ERROR" && error.message !== "" && error.message !== error.code;
  const status = getHTTPStatusCodeFromError(error);
  return refusal(accept, status, code, worded ? error.message : t(`mcp.refused.${code}`));
}

/** The file's name, twice: as ASCII for any client, and exactly, per RFC 6266, for the rest. */
function attachment(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7E]|["\\]/gu, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** What one download is about, read off its request once. */
interface Asked {
  readonly accept: string | undefined;
  readonly tenantId: string;
  readonly id: string;
}

/** The export, read through the router as this caller; or the refusal the router gave. */
async function opened(
  deps: ExportRouteDeps,
  ctx: Context,
  asked: Asked,
): Promise<ExportRow | Response> {
  try {
    return await appRouter.createCaller(ctx).bi.exports.get({
      tenantId: asked.tenantId,
      id: asked.id,
    });
  } catch (error) {
    if (!(error instanceof TRPCError)) {
      throw error;
    }
    if (error.code === "INTERNAL_SERVER_ERROR") {
      // The type, never the message, as `/trpc`'s `onError` logs it.
      deps.log?.error("export_failed", {
        errorType: describeError(error.cause ?? error).errorType,
      });
    }
    return refusalOf(asked.accept, ctx.locale, error);
  }
}

/** The worker's stream of the export's rows, or the refusal for one it would not start. */
async function streamed(
  ctx: Context,
  asked: Asked,
  row: ExportRow,
): Promise<ReadableStream<Uint8Array> | Response> {
  const t = messages(ctx.locale);
  if (ctx.worker === null) {
    return refusal(asked.accept, 503, "CONFLICT", t("error.workerUnavailable"));
  }
  const outcome = await ctx.worker.exportQuery({ tenantId: asked.tenantId, sql: row.sql });
  if (outcome.ok) {
    return outcome.value;
  }
  if (outcome.reason === "query-failed") {
    const sentence = t("error.queryFailed", { message: outcome.message ?? "" });
    return refusal(asked.accept, 400, "VALIDATION_FAILED", sentence);
  }
  return outcome.reason === "busy"
    ? refusal(asked.accept, 503, "CONFLICT", t("error.workerBusy"))
    : refusal(asked.accept, 502, "INTERNAL_ERROR", t("error.queryNotRun"));
}

/** The file itself: never cached, never sniffed into anything but CSV. */
function file(body: ReadableStream<Uint8Array>, fileName: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": CSV_MEDIA_TYPE,
      "content-disposition": attachment(fileName),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export function registerExportRoute(app: Hono, deps: ExportRouteDeps): void {
  app.get(EXPORT_ROUTE, async (c) => {
    const asked: Asked = {
      accept: c.req.header("accept"),
      tenantId: c.req.param("tenantId"),
      id: c.req.param("id"),
    };
    const ctx = await deps.admit(c.req.raw.headers);
    if ("reason" in ctx) {
      const locale = negotiateLocale(c.req.header("accept-language") ?? null);
      const sentence = messages(locale)("export.signIn");
      return refusal(asked.accept, 401, "AUTHENTICATION_REQUIRED", sentence);
    }
    const row = await opened(deps, ctx, asked);
    if (row instanceof Response) {
      return row;
    }
    // An export's first rows can take minutes to compute, and Bun would cut a request that sends
    // nothing for ten seconds. The worker's own deadlines bound it instead.
    liftIdleTimeout(c.env, c.req.raw);
    const body = await streamed(ctx, asked, row);
    if (body instanceof Response) {
      return body;
    }
    // Who took which export, by id -- never its SQL, its file name or a row.
    deps.log?.info("export_download", {
      tenantId: asked.tenantId,
      export: row.id,
      via: ctx.via,
      credential: ctx.credentialId,
    });
    // And in the audit log, where a person reads it (ADR 0113). The router has admitted the
    // caller by now, so `user` is set; the guard is for the type, not a case that happens.
    if (ctx.user !== null) {
      await recordAction(ctx.exec, {
        tenantId: asked.tenantId,
        actor: actorOf({ ...ctx, user: ctx.user }),
        action: "bi.exports.download",
        detail: { id: row.id },
      });
    }
    return file(body, row.fileName);
  });
}

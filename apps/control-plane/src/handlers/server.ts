/**
 * The control-plane HTTP surface: tRPC at /trpc, plus the plain routes whose callers are
 * not TypeScript clients (health, and OAuth redirects a provider drives), plus the built
 * SPA served at the same origin.
 *
 * Same-origin is not incidental: the SPA's tRPC client calls `/trpc` with no configured
 * base URL, so the browser attaches the session cookie automatically. Serving the app from
 * anywhere else would mean CORS and a cross-site cookie, which is the arrangement ADR 0004
 * set out to avoid.
 *
 * The control plane is one of the two long-running services and is deliberately
 * stoppable: it holds no pipeline and runs no connector, so stopping it leaves ingestion
 * (Kestra -> worker -> lake -> raw) untouched. ADR 0004.
 */

import { extname, join, normalize, sep } from "node:path";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { describeError } from "@undercroft/core";
import { traceRequests } from "@undercroft/telemetry";
import { Hono } from "hono";
import { isAdminIn } from "../services/authz.ts";
import { NO_SUPERADMINS } from "../services/superadmin.ts";
import { unavailableJudge } from "../services/assistant/judge.ts";
import { registerAssistantRoutes } from "./chat.ts";
import { createContext, resolveCaller, type ServerDeps } from "./context.ts";
import { registerMcpRoute } from "./mcp.ts";
import { registerOAuthRoutes } from "./oauth.ts";
import { appRouter } from "./router.ts";

export type { ServerDeps } from "./context.ts";

/**
 * Content types for the handful of extensions a Vite build emits. Explicit rather than
 * inferred from a BunFile, so the response body is a plain byte array that behaves the same
 * under Bun and under the test harness's DOM globals -- an unknown extension is served as
 * an opaque download rather than guessed.
 */
/** Any run of leading `../` (or `..\`) segments, which is how a path escapes `dist`. */
const LEADING_PARENT_SEGMENTS = /^(?:\.\.(?:\/|\\|$))+/u;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".map": "application/json",
};

/**
 * The tRPC endpoint. The caller and the locale come from `createContext`, which the assistant
 * route also calls -- one definition of who is asking.
 */
function registerTrpcRoute(app: Hono, deps: ServerDeps): void {
  app.all("/trpc/*", async (c) => {
    // The cookie door, and only the cookie: a bearer is `/mcp`'s, and a browser's own API must
    // not start answering to one because a header happened to be set.
    const context = await createContext(deps, c.req.raw.headers, "cookie");
    return await fetchRequestHandler({
      endpoint: "/trpc",
      req: c.req.raw,
      router: appRouter,
      createContext: () => context,
      // The code and the procedure, and the error's type -- never its message, which the
      // formatter keeps from the browser for the same reason it is kept from this line.
      // The trace id comes with the logger, so the line and the answer share one handle.
      onError: ({ error, path }) => {
        if (error.code === "INTERNAL_SERVER_ERROR") {
          deps.log?.error("trpc_failed", {
            path: path ?? "",
            code: error.code,
            errorType: describeError(error.cause ?? error).errorType,
          });
        }
      },
    });
  });
}

/**
 * The built SPA, registered LAST so /api and /trpc always win over the catch-all. A real
 * built asset gets that file; anything else gets index.html, because a 404 is a blank page
 * and a deep link like /tenants/42 is the SPA's to resolve.
 */
function registerSpaRoutes(app: Hono, deps: ServerDeps): void {
  if (deps.uiDist !== undefined) {
    const dist = deps.uiDist;
    const indexHtml = join(dist, "index.html");
    // The release beacon (`apps/ui/vite.config.ts`, ADR 0055): a worker's URL is its identity,
    // so it cannot be hashed, and pinned for a year it would announce no release at all.
    const releaseBeacon = join(dist, "sw.js");

    app.get("/*", async (c) => {
      const asset = await resolveAsset(dist, c.req.path);
      const path = asset ?? indexHtml;
      const file = Bun.file(path);
      if (!(await file.exists())) {
        return c.notFound();
      }
      // A hashed asset filename is immutable; index.html and the beacon must never be, or a
      // deploy ships a shell that keeps pointing at the previous build's bundles and a tab
      // that is never told about it.
      const immutable = asset !== null && asset !== indexHtml && asset !== releaseBeacon;
      return new Response(new Uint8Array(await file.arrayBuffer()), {
        headers: {
          "content-type": CONTENT_TYPES[extname(path)] ?? "application/octet-stream",
          "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
        },
      });
    });
  }
}

/**
 * The per-tenant consent callback.
 *
 * Unconditional, because a callback that 404s is a diagnosable misconfiguration whereas one
 * that serves the app shell is a consent that appears to work and never completes. With no
 * client or worker configured the service refuses it, which is the honest answer.
 */
function registerConsentRoute(app: Hono, deps: ServerDeps): void {
  registerOAuthRoutes(app, {
    exec: deps.exec,
    ...(deps.googleIngest === undefined ? {} : { google: deps.googleIngest }),
    ...(deps.xero === undefined ? {} : { xero: deps.xero }),
    ...(deps.worker === undefined ? {} : { worker: deps.worker }),
    // Through `authz.isAdminIn`, which is the same policy `tenantProcedure` resolves. Asking
    // `roleFor` here instead -- as this line first did -- reads a `tenant_member` row that a
    // superadmin deliberately does not have, so the platform administrator who is the only
    // person able to set a fresh deployment up was the one person who could never finish a
    // consent.
    hasAdminAuthority: (tenantId, caller) =>
      isAdminIn(deps.exec, deps.superadmins ?? NO_SUPERADMINS, { tenantId, ...caller }),
    resolveCaller: async (headers) => (await resolveCaller(deps, headers, "cookie")).user,
  });
}

export function createServer(deps: ServerDeps): Hono {
  const app = new Hono();

  // First, so every route below -- sign-in, tRPC, the assistant, the SPA -- answers with an
  // `x-trace-id`, and whatever it logs carries the same id. ADR 0058.
  app.use("*", traceRequests());

  app.get("/api/health", (c) => c.json({ ok: true }));

  // Registered BEFORE the SPA catch-all below, and with `all` rather than `get`. Both
  // matter: the catch-all answers any GET with index.html, so an auth route registered
  // after it would turn Google's redirect to /api/auth/callback/google into a 200 serving
  // the app shell -- a sign-in that silently never completes.
  if (deps.auth !== undefined) {
    const { auth } = deps;
    app.all("/api/auth/*", (c) => auth.handler(c.req.raw));
  }

  // Registered here so it wins over the catch-all at the foot of this function.
  registerConsentRoute(app, deps);

  registerTrpcRoute(app, deps);

  // The assistant, and the same hazard once more: `/api/assistant/chat` is a POST, but the
  // catch-all below answers a GET for it with index.html, and `useChat`'s error on a body of
  // HTML is unreadable. Registered unconditionally so an unconfigured assistant refuses in
  // the caller's language rather than 404ing into the app shell.
  registerAssistantRoutes(app, {
    exec: deps.exec,
    createContext: (headers) => createContext(deps, headers, "cookie"),
    // Not spread conditionally: an absent gate is `unavailableJudge`, which DENIES the write
    // tier, so the route handles a verdict rather than a null. That is the honest default.
    judge: deps.judge ?? unavailableJudge,
    ...(deps.assistant === undefined ? {} : { assistant: deps.assistant }),
  });

  // The model-context door (ADR 0059): a bearer, never the cookie. Before the catch-all for the
  // same reason as the two above -- a client's GET here must not be answered with the app shell.
  registerMcpRoute(app, {
    createContext: (headers) => createContext(deps, headers, "bearer"),
    ...(deps.publicUrl === undefined ? {} : { publicUrl: deps.publicUrl }),
    ...(deps.release === undefined ? {} : { release: deps.release }),
    ...(deps.log === undefined ? {} : { log: deps.log }),
  });

  // Registered LAST, so /api and /trpc above always win over the catch-all. A request for a
  // real built asset gets that file; anything else gets index.html, because the router lives
  // in the browser and a deep link like /tenants/42 is the SPA's to resolve, not a 404.
  registerSpaRoutes(app, deps);

  return app;
}

/**
 * Map a URL path to a file inside `dist`, or null to fall back to index.html. Returns null
 * for `/` and for anything that escapes `dist` — a request for `/../secrets` normalizes and
 * is refused rather than reaching outside the build.
 */
async function resolveAsset(dist: string, urlPath: string): Promise<string | null> {
  const rel = normalize(decodeURIComponent(urlPath)).replace(LEADING_PARENT_SEGMENTS, "");
  if (rel === "/" || rel === "." || rel === sep) {
    return null;
  }
  const candidate = join(dist, rel);
  if (candidate !== dist && !candidate.startsWith(dist + sep)) {
    return null;
  }
  return (await Bun.file(candidate).exists()) ? candidate : null;
}

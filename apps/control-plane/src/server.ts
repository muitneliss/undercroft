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

import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { SqlExecutor } from "@undercroft/db";
import { Hono } from "hono";
import { extname, join, normalize, sep } from "node:path";
import { type Context, userForSession } from "./trpc.ts";
import { appRouter } from "./router/index.ts";

const SESSION_COOKIE = "undercroft_session";

/**
 * Content types for the handful of extensions a Vite build emits. Explicit rather than
 * inferred from a BunFile, so the response body is a plain byte array that behaves the same
 * under Bun and under the test harness's DOM globals -- an unknown extension is served as
 * an opaque download rather than guessed.
 */
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

function readCookie(header: string | undefined, name: string): string {
  if (header === undefined) return "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

export interface ServerDeps {
  readonly exec: SqlExecutor;
  /**
   * Absolute path to the built SPA (`apps/ui/dist`). When set, the app serves those files
   * and falls back to `index.html` for client-side routes. When unset — a test, or a
   * process with no UI baked in — only `/api` and `/trpc` exist, and everything else 404s.
   */
  readonly uiDist?: string;
}

export function createServer(deps: ServerDeps): Hono {
  const app = new Hono();

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.all("/trpc/*", async (c) => {
    const cookies: string[] = [];
    const sessionId = readCookie(c.req.header("cookie"), SESSION_COOKIE);
    const user = await userForSession(deps.exec, sessionId);

    const response = await fetchRequestHandler({
      endpoint: "/trpc",
      req: c.req.raw,
      router: appRouter,
      createContext: (): Context => ({
        exec: deps.exec,
        user,
        sessionId,
        setCookie: (value) => cookies.push(value),
      }),
    });
    for (const cookie of cookies) response.headers.append("set-cookie", cookie);
    return response;
  });

  // Registered LAST, so /api and /trpc above always win over the catch-all. A request for a
  // real built asset gets that file; anything else gets index.html, because the router lives
  // in the browser and a deep link like /tenants/42 is the SPA's to resolve, not a 404.
  if (deps.uiDist !== undefined) {
    const dist = deps.uiDist;
    const indexHtml = join(dist, "index.html");

    app.get("/*", async (c) => {
      const asset = await resolveAsset(dist, c.req.path);
      const path = asset ?? indexHtml;
      const file = Bun.file(path);
      if (!(await file.exists())) return c.notFound();
      // A hashed asset filename is immutable; index.html must never be, or a deploy ships a
      // shell that keeps pointing at the previous build's bundles.
      const immutable = asset !== null && asset !== indexHtml;
      return new Response(new Uint8Array(await file.arrayBuffer()), {
        headers: {
          "content-type": CONTENT_TYPES[extname(path)] ?? "application/octet-stream",
          "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
        },
      });
    });
  }

  return app;
}

/**
 * Map a URL path to a file inside `dist`, or null to fall back to index.html. Returns null
 * for `/` and for anything that escapes `dist` — a request for `/../secrets` normalizes and
 * is refused rather than reaching outside the build.
 */
async function resolveAsset(dist: string, urlPath: string): Promise<string | null> {
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.(\/|\\|$))+/, "");
  if (rel === "/" || rel === "." || rel === sep) return null;
  const candidate = join(dist, rel);
  if (candidate !== dist && !candidate.startsWith(dist + sep)) return null;
  return (await Bun.file(candidate).exists()) ? candidate : null;
}

export { appRouter } from "./router/index.ts";
export type { AppRouter } from "./router/index.ts";

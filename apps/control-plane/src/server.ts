/**
 * The control-plane HTTP surface: tRPC at /trpc, plus the plain routes whose callers are
 * not TypeScript clients (health, and OAuth redirects a provider drives).
 *
 * The control plane is one of the two long-running services and is deliberately
 * stoppable: it holds no pipeline and runs no connector, so stopping it leaves ingestion
 * (Kestra -> worker -> lake -> raw) untouched. ADR 0004.
 */

import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { SqlExecutor } from "@undercroft/db";
import { Hono } from "hono";
import { type Context, userForSession } from "./trpc.ts";
import { appRouter } from "./router/index.ts";

const SESSION_COOKIE = "undercroft_session";

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

  return app;
}

export { appRouter } from "./router/index.ts";
export type { AppRouter } from "./router/index.ts";

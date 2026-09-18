/**
 * Serving the SPA must not swallow the API. The catch-all that makes deep links work is one
 * greedy route away from eating `/api/health` and `/trpc`, which would present as the whole
 * backend being down.
 *
 * Exercised through the real Hono app via `app.fetch`. The database is not part of this
 * behaviour, so `exec` is an executor that throws if touched -- that turns an accidental
 * query during static serving into a loud failure rather than a silent dependency.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SqlExecutor } from "@undercroft/db";
import { createServer } from "./server.ts";

const noDatabase: SqlExecutor = {
  query: () => Promise.reject(new Error("static serving must not touch the database")),
  exec: () => Promise.reject(new Error("static serving must not touch the database")),
};

let dist: string;

beforeAll(async () => {
  dist = await mkdtemp(join(tmpdir(), "undercroft-ui-"));
  await writeFile(join(dist, "index.html"), "<!doctype html><title>Undercroft</title>");
  await writeFile(join(dist, "app.js"), "console.log('bundle');");
});

afterAll(async () => {
  await rm(dist, { recursive: true, force: true });
});

describe("the SPA is served without shadowing the API", () => {
  test("an unknown route falls back to index.html so the browser router can resolve it", async () => {
    const app = createServer({ exec: noDatabase, uiDist: dist });

    const response = await app.fetch(new Request("http://c/tenants/42"));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Undercroft");
  });

  test("a real built asset is served as itself, not the index fallback", async () => {
    const app = createServer({ exec: noDatabase, uiDist: dist });

    const response = await app.fetch(new Request("http://c/app.js"));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("bundle");
  });

  test("the health route still answers with the SPA mounted", async () => {
    const app = createServer({ exec: noDatabase, uiDist: dist });

    const response = await app.fetch(new Request("http://c/api/health"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  test("a traversal out of the dist directory is refused, not served", async () => {
    const app = createServer({ exec: noDatabase, uiDist: dist });

    // Encoded so it reaches the handler intact rather than being collapsed by the URL parser.
    const response = await app.fetch(new Request("http://c/..%2f..%2fetc%2fpasswd"));

    // Refused as a file: it falls through to the SPA shell, never to a path outside dist.
    expect(await response.text()).toContain("Undercroft");
  });

  test("Google's consent callback is not swallowed by the SPA fallback", async () => {
    // The exact hazard `/api/auth/*` carries a comment about, now for a second OAuth route.
    // Registered after the catch-all this would answer 200 with index.html: a consent that
    // appears to work, never completes, and leaves nothing anywhere explaining why.
    const app = createServer({ exec: noDatabase, uiDist: dist });

    const response = await app.fetch(new Request("http://c/oauth/google/callback?error=denied"));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("connect=failed");
  });
});

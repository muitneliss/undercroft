/**
 * Serving the SPA must not swallow the API. The catch-all that makes deep links work is one
 * greedy route away from eating `/api/health` and `/trpc`, which would present as the whole
 * backend being down.
 *
 * Exercised through the real Hono app via `app.fetch`. The database is not part of this
 * behaviour, so `exec` is an executor that throws if touched -- that turns an accidental
 * query during static serving into a loud failure rather than a silent dependency.
 */

// biome-ignore-all lint/correctness/noNodejsModules: This is server code running on Bun. `node:` builtins are the platform here, not a portability hazard -- the rule exists for code that must also run in a browser.
// biome-ignore-all lint/nursery/noBunModules: Bun is the test runner, per CLAUDE.md: 'Bun is the runtime, package manager, workspace manager and test runner.' `bun:test` is the toolchain, not an accidental dependency.

import { afterAll, beforeAll, describe, expect, test as it } from "bun:test";
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
  it("an unknown route falls back to index.html so the browser router can resolve it", async () => {
    const app = createServer({ exec: noDatabase, uiDist: dist });

    const response = await app.fetch(new Request("http://c/tenants/42"));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Undercroft");
  });

  it("a real built asset is served as itself, not the index fallback", async () => {
    const app = createServer({ exec: noDatabase, uiDist: dist });

    const response = await app.fetch(new Request("http://c/app.js"));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("bundle");
  });

  it("the health route still answers with the SPA mounted", async () => {
    const app = createServer({ exec: noDatabase, uiDist: dist });

    const response = await app.fetch(new Request("http://c/api/health"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("a traversal out of the dist directory is refused, not served", async () => {
    const app = createServer({ exec: noDatabase, uiDist: dist });

    // Encoded so it reaches the handler intact rather than being collapsed by the URL parser.
    const response = await app.fetch(new Request("http://c/..%2f..%2fetc%2fpasswd"));

    // Refused as a file: it falls through to the SPA shell, never to a path outside dist.
    expect(await response.text()).toContain("Undercroft");
  });
});

/**
 * A procedure that waits on purpose is not cut by Bun's idle timeout, at either door (ADR 0124).
 *
 * Over real HTTP against `startControlPlane()`, because the property lives in the socket: Bun
 * closes a request that has sent nothing for `idleTimeout` seconds, and only a real `Bun.serve`
 * does that. The server here keeps one second, so a wait of six would be cut -- Bun checks its
 * timeouts every few seconds, which is why the wait is six and not two -- unless the procedure's
 * meta lifted it. Both doors are asked at once: the cookie's `/trpc`, and a bearer's `/mcp`.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { TestDatabase } from "@undercroft/db/testing";
import { type ControlPlane, startControlPlane } from "../testing.ts";
import { appRouter } from "./router.ts";

const OPERATOR = "operator@example.test";
const TENANT = "CASE-0042";
/** Long enough that a request nobody lifted is cut, at a one-second idle timeout. */
const WAIT_SECONDS = 6;

/**
 * The procedures that hold their request open. A procedure added here is a decision an ADR (0124, 0126)
 * records; one that declares it without a record shows up here first.
 */
describe("which procedures hold their request open", () => {
  it("is runs.get, for its wait, and models.build, for the worker's deadline, each with its answer", () => {
    const held = Object.entries(appRouter._def.procedures).flatMap(([path, procedure]) => {
      const seconds: unknown = Reflect.get(
        Reflect.get(procedure, "_def") ?? {},
        "meta",
      )?.holdsOpenSeconds;
      return seconds === undefined ? [] : [[path, seconds]];
    });

    // models.build: the control plane's 150 s wait on the worker, plus ten to answer -- under
    // Bun's 255, and under the CLI's 180 s request timeout, so neither cuts a build it waits on.
    expect(held).toEqual([
      ["models.build", 160],
      ["runs.get", 60],
    ]);
  });
});

describe("a wait at either door", () => {
  let plane: ControlPlane;

  async function seed(db: TestDatabase): Promise<void> {
    await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [TENANT]);
    await db.query(
      `INSERT INTO app.invitation (tenant_id, email, role, token_sha256, expires_at)
       VALUES ($1, $2, 'admin', repeat('a', 64), now() + interval '7 days')`,
      [TENANT, OPERATOR],
    );
    // A run nothing will close: the wait runs its whole course.
    await db.query(
      `INSERT INTO ops.run (id, tenant_id, source, verb, trigger)
       VALUES ('run-long', $1, 'hubspot', 'ingest', 'manual')`,
      [TENANT],
    );
  }

  beforeEach(async () => {
    plane = await startControlPlane({ devSignInAs: OPERATOR, seed, idleTimeout: 1 });
  });

  afterEach(async () => {
    await plane.stop();
  });

  async function signIn(): Promise<string> {
    const signedIn = await Bun.fetch(`${plane.origin}/api/auth/sign-in/dev`, {
      method: "POST",
      headers: { origin: plane.origin },
    });
    return signedIn.headers.getSetCookie().join("; ");
  }

  async function viaTrpc(cookie: string): Promise<unknown> {
    const input = encodeURIComponent(
      JSON.stringify({ tenantId: TENANT, runId: "run-long", waitSeconds: WAIT_SECONDS }),
    );
    const response = await Bun.fetch(`${plane.origin}/trpc/runs.get?input=${input}`, {
      headers: { cookie },
    });
    const body = (await response.json()) as { result: { data: { status: string } } };
    return body.result.data.status;
  }

  async function viaMcp(cookie: string): Promise<unknown> {
    const minted = await Bun.fetch(`${plane.origin}/trpc/account.tokens.mint`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ label: "agent", grant: "read", expiresInDays: 1 }),
    });
    const { token } = ((await minted.json()) as { result: { data: { token: string } } }).result
      .data;
    const client = new Client({ name: "holdOpen.test", version: "0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL("/mcp", plane.origin), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
    );
    try {
      const result = await client.callTool({
        name: "runs_get",
        arguments: { tenantId: TENANT, runId: "run-long", waitSeconds: WAIT_SECONDS },
      });
      const content = result.structuredContent as { status?: unknown } | undefined;
      return content?.status;
    } finally {
      await client.close();
    }
  }

  it(
    "answers when the wait runs out, still `running`, instead of the connection being cut",
    async () => {
      const cookie = await signIn();
      const started = Date.now();

      const [trpc, mcp] = await Promise.all([viaTrpc(cookie), viaMcp(cookie)]);

      expect([trpc, mcp]).toEqual(["running", "running"]);
      // It did wait: an answer that came back at once proves nothing about the timeout.
      expect(Date.now() - started).toBeGreaterThanOrEqual(WAIT_SECONDS * 1000);
    },
    (WAIT_SECONDS + 10) * 1000,
  );
});

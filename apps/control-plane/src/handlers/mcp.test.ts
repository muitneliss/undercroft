/**
 * `/mcp`, as a model-context client sees it: the real `@modelcontextprotocol/client` over real
 * HTTP against `startControlPlane()` -- real Better Auth, the real router, PGlite running as
 * `undercroft_app`, the in-memory worker. Nothing is mocked.
 *
 * Tokens are minted the way a person mints them, through `/trpc/account.tokens.mint` with the
 * session cookie of a signed-in browser, so every test starts from a credential the product
 * itself issued. What is asserted is what a client sees: the tools it is offered, the answer or
 * refusal a call gets, the status of the HTTP exchange -- and, for a write, whether the worker
 * was actually asked to do it. For a bearer refused at the door, also what the operator is
 * left to find it by: the one `mcp_refused` line, written by the process's own logger into
 * memory.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { TRPCError } from "@trpc/server";
import { createLogger } from "@undercroft/core";
import { currentTraceId } from "@undercroft/telemetry";
import { type ControlPlane, startControlPlane } from "../testing.ts";
import { procedureSentences as en } from "../i18n/procedures.en.ts";
import { createContext } from "./context.ts";
import { appRouter } from "./router.ts";
import { MCP_EXCLUDED, SESSION_ONLY } from "./surface.ts";

const OPERATOR = "operator@example.test";
/** The operator's own tenant, and one that exists but is not theirs. */
const OWN = "CASE-0042";
const OTHER = "CASE-0099";

let plane: ControlPlane;
let cookie = "";
/** Every line the server logged, as the process's own logger writes it, trace id included. */
let logged: Record<string, unknown>[] = [];

beforeEach(async () => {
  logged = [];
  plane = await startControlPlane({
    devSignInAs: OPERATOR,
    log: createLogger({
      component: "control-plane",
      sink: (line) => logged.push(JSON.parse(line) as Record<string, unknown>),
      context: () => ({ traceId: currentTraceId() }),
    }),
    seed: async (db) => {
      await db.query("INSERT INTO ops.tenant (id) VALUES ($1), ($2)", [OWN, OTHER]);
      await db.query(
        `INSERT INTO app.invitation (tenant_id, email, role, token_sha256, expires_at)
         VALUES ($1, $2, 'admin', repeat('a', 64), now() + interval '7 days')`,
        [OWN, OPERATOR],
      );
    },
  });
  const signedIn = await Bun.fetch(`${plane.origin}/api/auth/sign-in/dev`, {
    method: "POST",
    headers: { origin: plane.origin },
  });
  cookie = signedIn.headers.getSetCookie().join("; ");
});

afterEach(async () => {
  await plane.stop();
});

/** Mint a token through the browser's own door, as the account page does. */
async function mint(grant: "read" | "write"): Promise<string> {
  const response = await Bun.fetch(`${plane.origin}/trpc/account.tokens.mint`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ label: "agent", grant, expiresInDays: 30 }),
  });
  const body = (await response.json()) as { result: { data: { token: string } } };
  return body.result.data.token;
}

/** A tool result's `structuredContent`, which the client types as an open object. */
function content(result: { structuredContent?: unknown }): Record<string, unknown> {
  const { structuredContent } = result;
  return typeof structuredContent === "object" && structuredContent !== null
    ? { ...structuredContent }
    : {};
}

async function connect(token: string, locale = "vi"): Promise<Client> {
  const client = new Client({ name: "mcp.test", version: "0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("/mcp", plane.origin), {
      requestInit: { headers: { authorization: `Bearer ${token}`, "accept-language": locale } },
    }),
  );
  return client;
}

async function toolNames(token: string): Promise<string[]> {
  const client = await connect(token);
  const { tools } = await client.listTools();
  await client.close();
  return tools.map((tool) => tool.name).sort();
}

/** One JSON-RPC `tools/list` over plain HTTP, for what a client library would hide: the status. */
function rawList(headers: Record<string, string>): Promise<Response> {
  return Bun.fetch(`${plane.origin}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
}

describe("the tools a token is offered", () => {
  it("is the router, less what is excluded and what only a session may call", async () => {
    const expected = Object.keys(appRouter._def.procedures)
      .filter((path) => !(path in MCP_EXCLUDED || SESSION_ONLY.some((only) => only === path)))
      .map((path) => path.replaceAll(".", "_"))
      .sort();

    expect(await toolNames(await mint("write"))).toEqual(expected);
  });

  it("holds no write for a read token", async () => {
    const client = await connect(await mint("read"));
    const { tools } = await client.listTools();
    await client.close();

    expect(tools.filter((tool) => tool.annotations?.readOnlyHint !== true)).toEqual([]);
  });

  it("describes each tool in the language the client asked for", async () => {
    const client = await connect(await mint("write"), "en");
    const { tools } = await client.listTools();
    await client.close();

    expect(tools.find((tool) => tool.name === "runs_trigger")?.description).toBe(
      en["runs.trigger"],
    );
  });
});

describe("a write through a token", () => {
  it("is refused to a read token before the worker is asked", async () => {
    const client = await connect(await mint("read"));
    const result = await client.callTool({
      name: "runs_trigger",
      arguments: { tenantId: OWN, source: "xero" },
    });
    await client.close();

    expect({
      code: content(result).code,
      triggered: plane.worker.triggered.length,
    }).toEqual({ code: "WRITES_DISABLED", triggered: 0 });
  });

  it("reaches the worker with a write token", async () => {
    const client = await connect(await mint("write"));
    await client.callTool({ name: "runs_trigger", arguments: { tenantId: OWN, source: "xero" } });
    await client.close();

    expect(plane.worker.triggered.map((run) => run.tenantId)).toEqual([OWN]);
  });
});

describe("the grant guard at the router, which every door goes through", () => {
  async function bearerCaller(token: string): Promise<ReturnType<typeof appRouter.createCaller>> {
    const headers = new Headers({ authorization: `Bearer ${token}` });
    return appRouter.createCaller(await createContext({ exec: plane.db }, headers, "bearer"));
  }

  it("refuses a read token's write, naming why", async () => {
    const caller = await bearerCaller(await mint("read"));
    const refusal = await caller.runs
      .trigger({ tenantId: OWN, source: "xero" })
      .catch((error: unknown) => error as TRPCError);

    expect(refusal).toMatchObject({
      code: "FORBIDDEN",
      cause: { facts: { reason: "WRITES_DISABLED" } },
    });
  });

  it("lets a read token read", async () => {
    const caller = await bearerCaller(await mint("read"));

    expect(await caller.runs.list({ tenantId: OWN })).toEqual({ items: [], nextCursor: null });
  });

  it("refuses a bearer the procedures that manage credentials", async () => {
    const caller = await bearerCaller(await mint("write"));
    const refusal = await caller.account.tokens
      .mint({ label: "escalated", grant: "write", expiresInDays: 30 })
      .catch((error: unknown) => error as TRPCError);

    expect(refusal).toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("a session-only procedure", () => {
  it("mints from the browser's session", async () => {
    expect(await mint("write")).toMatch(/^upat_[\w-]{8}\./u);
  });

  it("is not a tool a token can call", async () => {
    const client = await connect(await mint("write"));
    const refusal = await client
      .callTool({
        name: "account_tokens_mint",
        arguments: { label: "escalated", grant: "write", expiresInDays: 30 },
      })
      .catch((error: unknown) => error as { code: number });
    await client.close();

    // JSON-RPC's invalid params: the protocol's answer to a tool nobody listed.
    expect(refusal).toMatchObject({ code: -32_602 });
  });
});

describe("another tenant's data", () => {
  it("is NOT_FOUND, not an empty answer", async () => {
    const client = await connect(await mint("write"));
    const result = await client.callTool({ name: "runs_list", arguments: { tenantId: OTHER } });
    await client.close();

    expect({ isError: result.isError, code: content(result).code }).toEqual({
      isError: true,
      code: "NOT_FOUND",
    });
  });
});

describe("a long answer", () => {
  it("is whole in structuredContent, and the model's text says where it was cut", async () => {
    await plane.db.query(
      `INSERT INTO ops.run (id, tenant_id, source, verb, status)
       SELECT 'run-' || g, $1, 'xero', 'ingest', 'ok' FROM generate_series(1, 60) g`,
      [OWN],
    );
    const client = await connect(await mint("read"), "en");
    const result = await client.callTool({
      name: "runs_list",
      arguments: { tenantId: OWN, limit: 100 },
    });
    await client.close();

    const { items } = content(result);
    const texts = (result.content as { type: string; text: string }[]).map((part) => part.text);
    expect({ whole: Array.isArray(items) ? items.length : null, note: texts[1] }).toEqual({
      whole: 60,
      note: "This text shows 50 of the 60 items in items. The complete result is in structuredContent.",
    });
  });
});

describe("an answer a widget draws", () => {
  it("names its widget in the tool list, and the widget is served as an MCP app page", async () => {
    const client = await connect(await mint("read"));
    const { tools } = await client.listTools();
    const ui = tools.find((tool) => tool.name === "bi_answer")?._meta?.ui as
      | { resourceUri?: string }
      | undefined;
    const uri = ui?.resourceUri ?? "";
    const { contents } = await client.readResource({ uri });
    await client.close();

    const [page] = contents;
    expect({
      uri,
      mimeType: page?.mimeType,
      html: page !== undefined && "text" in page && page.text.startsWith("<!doctype html>"),
    }).toEqual({
      uri: "ui://undercroft/grid.html",
      mimeType: "text/html;profile=mcp-app",
      html: true,
    });
  });
});

describe("a caller with no live token", () => {
  it("is challenged with where to learn how to get one", async () => {
    const response = await rawList({});

    expect({
      status: response.status,
      challenge: response.headers.get("www-authenticate"),
    }).toEqual({
      status: 401,
      challenge: expect.stringContaining(
        `resource_metadata="${plane.origin}/.well-known/oauth-protected-resource/mcp"`,
      ),
    });
  });

  it("is not let in by a browser's session cookie", async () => {
    expect((await rawList({ cookie })).status).toBe(401);
  });

  it("is refused once the token is revoked", async () => {
    const token = await mint("write");
    const id = token.slice(0, token.indexOf("."));
    await Bun.fetch(`${plane.origin}/trpc/account.tokens.revoke`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });

    expect((await rawList({ authorization: `Bearer ${token}` })).status).toBe(401);
  });

  it("is refused once the token has expired", async () => {
    const token = await mint("write");
    await plane.db.query(
      `UPDATE app.access_token
       SET created_at = now() - interval '31 days', expires_at = now() - interval '1 day'`,
    );

    expect((await rawList({ authorization: `Bearer ${token}` })).status).toBe(401);
  });

  it("is let in with a live one", async () => {
    const token = await mint("read");

    expect((await rawList({ authorization: `Bearer ${token}` })).status).toBe(200);
  });
});

describe("a refused bearer, as an operator finds it", () => {
  /** Mint a token, revoke it through the account page's own procedure, and present it. */
  async function presentRevoked(): Promise<{ id: string; response: Response }> {
    const token = await mint("write");
    const id = token.slice(0, token.indexOf("."));
    await Bun.fetch(`${plane.origin}/trpc/account.tokens.revoke`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    return { id, response: await rawList({ authorization: `Bearer ${token}` }) };
  }

  function refusals(): Record<string, unknown>[] {
    return logged.filter((line) => line.event === "mcp_refused");
  }

  // The whole line, so a field that should not be there -- the token, or any part of it --
  // fails this as surely as a missing one.
  it("is logged with why, whose, and the trace id the refusal answered with", async () => {
    const { id, response } = await presentRevoked();

    expect(refusals()).toEqual([
      {
        at: expect.any(String),
        level: "warn",
        component: "control-plane",
        event: "mcp_refused",
        traceId: response.headers.get("x-trace-id"),
        status: 401,
        refusal: "invalid_token",
        reason: "revoked",
        credential: id,
      },
    ]);
  });

  it("tells the client nothing the reason would add", async () => {
    const { response } = await presentRevoked();
    const none = await rawList({});

    expect({
      challenge: response.headers.get("www-authenticate"),
      body: await response.text(),
    }).toEqual({ challenge: none.headers.get("www-authenticate"), body: await none.text() });
  });

  it("is a client's first contact when no bearer came, logged without a warning", async () => {
    await rawList({});

    expect(
      refusals().map(({ level, reason, credential }) => ({ level, reason, credential })),
    ).toEqual([{ level: "info", reason: "missing", credential: undefined }]);
  });

  it("is not written for a bearer that was let in", async () => {
    await rawList({ authorization: `Bearer ${await mint("read")}` });

    expect(refusals()).toEqual([]);
  });
});

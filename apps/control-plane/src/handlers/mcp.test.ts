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
import { createHash } from "node:crypto";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { ProtocolErrorCode } from "@modelcontextprotocol/server";
import type { TRPCError } from "@trpc/server";
import { byCodeUnit, createLogger } from "@undercroft/core";
import type { TestDatabase } from "@undercroft/db/testing";
import { currentTraceId } from "@undercroft/telemetry";
import { type ControlPlane, startControlPlane } from "../testing.ts";
import { procedureSentences as en } from "../i18n/procedures.en.ts";
import { z } from "zod";
import { readSkills, SKILLS_ROOT } from "../skills.ts";
import { createContext } from "./context.ts";
import { CLIPPED_NOTES_FIELD } from "./mcpAnswers.ts";
import { SKILLS_EXTENSION } from "./mcpSkills.ts";
import { WIDGET_ANSWER_META } from "./mcpWidgets.ts";
import { appRouter } from "./router.ts";
import { MCP_EXCLUDED, SESSION_ONLY } from "./surface.ts";

const OPERATOR = "operator@example.test";
/** The operator's own tenant, one that exists but is not theirs, and one they only view. */
const OWN = "CASE-0042";
const OTHER = "CASE-0099";
const VIEWED = "CASE-0077";

let plane: ControlPlane;
let cookie = "";
/** Every line the server logged, as the process's own logger writes it, trace id included. */
let logged: Record<string, unknown>[] = [];

/** The three tenants, and the operator's invitations: admin of their own, viewer of another. */
async function seed(db: TestDatabase): Promise<void> {
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1), ($2), ($3)", [OWN, OTHER, VIEWED]);
  await db.query(
    `INSERT INTO app.invitation (tenant_id, email, role, token_sha256, expires_at)
     VALUES ($1, $3, 'admin', repeat('a', 64), now() + interval '7 days'),
            ($2, $3, 'viewer', repeat('b', 64), now() + interval '7 days')`,
    [OWN, VIEWED, OPERATOR],
  );
}

/** A browser session for the operator, as the dev sign-in gives one. */
async function signIn(): Promise<string> {
  const signedIn = await Bun.fetch(`${plane.origin}/api/auth/sign-in/dev`, {
    method: "POST",
    headers: { origin: plane.origin },
  });
  return signedIn.headers.getSetCookie().join("; ");
}

beforeEach(async () => {
  logged = [];
  plane = await startControlPlane({
    devSignInAs: OPERATOR,
    log: createLogger({
      component: "control-plane",
      sink: (line) => logged.push(JSON.parse(line) as Record<string, unknown>),
      context: () => ({ traceId: currentTraceId() }),
    }),
    seed,
  });
  cookie = await signIn();
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
  return tools.map((tool) => tool.name).sort(byCodeUnit);
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
      .sort(byCodeUnit);

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

    // The procedure's sentence, then the permission its guard declares (ADR 0139): one fact,
    // read off the router, so the words a client reads cannot name a gate the router lacks.
    expect(tools.find((tool) => tool.name === "runs_trigger")?.description).toBe(
      `${en["runs.trigger"]} Needs sources:manage.`,
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

  it("refused to a read token at the door, is in the audit log as the router would write it", async () => {
    const token = await mint("read");
    const client = await connect(token);
    await client.callTool({ name: "runs_trigger", arguments: { tenantId: OWN, source: "xero" } });
    await client.close();

    const { rows } = await plane.db.query<Record<string, unknown>>(
      `SELECT action, tenant_id, actor, channel, credential, outcome, reason
         FROM ops.audit_log WHERE outcome = 'refused' ORDER BY id`,
    );
    expect(rows).toEqual([
      {
        action: "runs.trigger",
        tenant_id: OWN,
        actor: OPERATOR,
        channel: "mcp",
        credential: token.slice(0, token.indexOf(".")),
        outcome: "refused",
        reason: "WRITES_DISABLED",
      },
    ]);
  });

  it("refused to a read token at the door, is kept in the call log with what it sent (ADR 0151)", async () => {
    const client = await connect(await mint("read"));
    await client.callTool({ name: "runs_trigger", arguments: { tenantId: OWN, source: "xero" } });
    await client.close();

    const { rows } = await plane.db.query<Record<string, unknown>>(
      `SELECT path, type, channel, outcome, reason, request, response, error ->> 'code' AS code
         FROM ops.call_log WHERE outcome = 'refused' ORDER BY id`,
    );
    expect(rows).toEqual([
      {
        path: "runs.trigger",
        type: "mutation",
        channel: "mcp",
        outcome: "refused",
        reason: "WRITES_DISABLED",
        request: JSON.stringify({ tenantId: OWN, source: "xero" }),
        response: null,
        code: "FORBIDDEN",
      },
    ]);
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

  // What the consent page and the token form promise (#427): a write grant never reaches past
  // the role, so a viewer's write token buys no customer's write -- only the person's own.
  it("refuses a write token a customer's write where its holder is a viewer", async () => {
    const caller = await bearerCaller(await mint("write"));
    const refusal = await caller.runs.trigger({ tenantId: VIEWED, source: "xero" }).then(
      () => null,
      (error: unknown) => error as TRPCError,
    );

    expect({ code: refusal?.code, triggered: plane.worker.triggered.length }).toEqual({
      code: "FORBIDDEN",
      triggered: 0,
    });
  });

  it("lets the same write token change its holder's own language", async () => {
    const caller = await bearerCaller(await mint("write"));

    expect(await caller.session.setLocale({ locale: "en" })).toEqual({ ok: true });
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
  /** The text blocks a result carries: the JSON first, then one note per cut. */
  function texts(result: { content?: unknown }): string[] {
    return (result.content as { type: string; text: string }[]).map((part) => part.text);
  }

  /** The whole answer a result carries for a widget, if it carries one. */
  function whole(result: { _meta?: unknown }): Record<string, unknown> | null {
    const meta: unknown = result._meta;
    const answer: unknown =
      typeof meta === "object" && meta !== null ? Reflect.get(meta, WIDGET_ANSWER_META) : null;
    return typeof answer === "object" && answer !== null ? { ...answer } : null;
  }

  it("is clipped alike in the text and in structuredContent, each naming the cut", async () => {
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

    const { items, [CLIPPED_NOTES_FIELD]: notes } = content(result);
    const note =
      "This answer holds 50 of the 60 items in items. The rest was not sent: call again with a narrower scope (a filter, a limit or a cursor, where the tool takes one) to read it.";
    expect({
      structured: Array.isArray(items) ? items.length : null,
      notes,
      text: texts(result).slice(1),
      widget: whole(result),
    }).toEqual({ structured: 50, notes: [note], text: [note], widget: null });
  });

  it("past the bound, has no structuredContent; a widget still gets every row", async () => {
    const wide = "x".repeat(1500);
    plane.worker.answering({
      columns: [{ name: "wide", type: "text" }],
      rows: Array.from({ length: 120 }, () => [wide]),
      truncated: false,
    });
    const client = await connect(await mint("read"), "en");
    const result = await client.callTool({
      name: "bi_answer",
      arguments: { tenantId: OWN, definition: { kind: "sql", sql: "select wide" } },
    });
    await client.close();

    const [json = "", ...notes] = texts(result);
    const { rows } = whole(result) ?? {};
    expect({
      structured: result.structuredContent,
      textBytes: new TextEncoder().encode(json).length <= 60 * 1024,
      notes,
      widgetRows: Array.isArray(rows) ? rows.length : null,
    }).toEqual({
      structured: undefined,
      textBytes: true,
      notes: [
        "This answer holds 50 of the 120 items in rows. The rest was not sent: call again with a narrower scope (a filter, a limit or a cursor, where the tool takes one) to read it.",
        "This answer was cut at 60 KB and has no structuredContent. The rest was not sent: call again with a narrower scope (a filter, a limit or a cursor, where the tool takes one) to read it.",
      ],
      widgetRows: 120,
    });
  });

  it("that a widget polls for itself is whole for the widget, newest events included", async () => {
    await plane.db.asSuperuser(async (tx) => {
      await tx.query(
        "INSERT INTO ops.run (id, tenant_id, source, verb, status) VALUES ('run-1', $1, 'xero', 'ingest', 'running')",
        [OWN],
      );
      await tx.query(
        `INSERT INTO ops.run_event (run_id, level, event)
         SELECT 'run-1', 'info', 'step-' || g FROM generate_series(1, 60) g`,
      );
    });
    const client = await connect(await mint("read"), "en");
    const result = await client.callTool({
      name: "runs_events",
      arguments: { tenantId: OWN, runId: "run-1" },
    });
    await client.close();

    function newest(feed: unknown): unknown {
      return Array.isArray(feed)
        ? feed.map((event: { event?: unknown }) => event.event).at(-1)
        : null;
    }
    expect({
      model: newest(content(result).items),
      widget: newest(whole(result)?.items),
    }).toEqual({ model: "step-50", widget: "step-60" });
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

describe("the skills, over the MCP Skills extension", () => {
  const Entry = z.object({
    uri: z.string(),
    frontmatter: z.record(z.string(), z.unknown()),
    resources: z.array(z.object({ uri: z.string(), digest: z.string(), size: z.number() })),
  });
  // `resultType` is envelope: the client consumes it before a result schema sees the rest,
  // so it is asserted on the wire below, where a client library cannot hide it.
  const Cached = { ttlMs: z.number(), cacheScope: z.string() };
  const Listed = z.object({ ...Cached, skills: z.array(Entry) });
  const Got = z.object({ ...Cached, skill: Entry });

  function listSkills(client: Client) {
    return client.request({ method: "skills/list", params: {} }, Listed);
  }

  it("is declared, with resources, and lists every skill in the repository", async () => {
    const client = await connect(await mint("read"));
    const capabilities = client.getServerCapabilities();
    const { skills } = await listSkills(client);
    await client.close();

    expect(capabilities?.extensions?.[SKILLS_EXTENSION]).toEqual({});
    expect(capabilities?.resources).toBeDefined();
    expect(skills.map((skill) => skill.uri)).toEqual(
      readSkills(SKILLS_ROOT).map((skill) => `skill://${skill.name}/SKILL.md`),
    );
  });

  it("serves every file with the digest and size its manifest promised", async () => {
    const client = await connect(await mint("read"));
    const { skills } = await listSkills(client);
    const mismatched: string[] = [];
    for (const { resources } of skills) {
      for (const { uri, digest, size } of resources) {
        const [file] = (await client.readResource({ uri })).contents;
        const bytes = new TextEncoder().encode(
          file !== undefined && "text" in file ? file.text : "",
        );
        const actual = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
        if (actual !== digest || bytes.byteLength !== size) {
          mismatched.push(uri);
        }
      }
    }
    await client.close();
    expect(mismatched).toEqual([]);
  });

  it("gives each SKILL.md the frontmatter its listing advertised", async () => {
    const client = await connect(await mint("read"));
    const { skills } = await listSkills(client);
    const entry = skills.find((skill) => skill.uri === "skill://undercroft/SKILL.md");
    const [file] = (await client.readResource({ uri: entry?.uri ?? "" })).contents;
    await client.close();

    const text = file !== undefined && "text" in file ? file.text : "";
    expect(entry?.frontmatter.name).toBe("undercroft");
    expect(text.startsWith("---\nname: undercroft\n")).toBe(true);
    expect(file?.mimeType).toBe("text/markdown");
  });

  it("says on the wire that each answer is complete, and how long it may be kept", async () => {
    const response = await Bun.fetch(`${plane.origin}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await mint("read")}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "skills/list",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "skills/list",
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": { name: "mcp.test", version: "0" },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    });
    const { result } = (await response.json()) as { result: Record<string, unknown> };
    expect({
      resultType: result.resultType,
      ttlMs: result.ttlMs,
      cacheScope: result.cacheScope,
    }).toEqual({ resultType: "complete", ttlMs: 300_000, cacheScope: "public" });
  });

  it("answers skills/get for a skill by its URI", async () => {
    const client = await connect(await mint("read"));
    const got = await client.request(
      { method: "skills/get", params: { uri: "skill://undercroft-model-builder/SKILL.md" } },
      Got,
    );
    await client.close();
    expect(got.skill.frontmatter.name).toBe("undercroft-model-builder");
  });

  it("refuses an unknown skill, an unknown file and a path that climbs out, as invalid params", async () => {
    const client = await connect(await mint("read"));
    const codes: unknown[] = [];
    const attempts = [
      () => client.request({ method: "skills/get", params: { uri: "skill://nope/SKILL.md" } }, Got),
      () => client.readResource({ uri: "skill://undercroft/references/nope.md" }),
      () => client.readResource({ uri: "skill://undercroft/../../package.json" }),
    ];
    for (const attempt of attempts) {
      try {
        await attempt();
        codes.push("answered");
      } catch (error) {
        codes.push(error instanceof Error && "code" in error ? error.code : "thrown");
      }
    }
    await client.close();
    const invalid = ProtocolErrorCode.InvalidParams;
    expect(codes).toEqual([invalid, invalid, invalid]);
  });

  it("keeps the widgets readable beside the skills, and out of each other's way", async () => {
    const client = await connect(await mint("read"));
    const { resources } = await client.listResources();
    await client.close();
    expect(resources.map((resource) => resource.uri).every((uri) => uri.startsWith("ui://"))).toBe(
      true,
    );
  });
});

describe("a control plane with no skills to serve", () => {
  it("does not declare the extension, and serves every tool as before", async () => {
    await plane.stop();
    plane = await startControlPlane({ devSignInAs: OPERATOR, seed, skills: [] });
    cookie = await signIn();
    const client = await connect(await mint("read"));
    const capabilities = client.getServerCapabilities();
    const { tools } = await client.listTools();
    await client.close();

    expect(capabilities?.extensions?.[SKILLS_EXTENSION]).toBeUndefined();
    expect(tools.length).toBeGreaterThan(0);
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

describe("a refused bearer, as a person reads it in the audit log (ADR 0120)", () => {
  /** Every `auth.tokenRefused` row, whole, so a column that should not hold something fails. */
  async function tokenRefusals(): Promise<Record<string, unknown>[]> {
    const { rows } = await plane.db.query<Record<string, unknown>>(
      `SELECT tenant_id, actor, user_id::text AS user_id, channel, credential, outcome, reason,
              detail
         FROM ops.audit_log WHERE action = 'auth.tokenRefused' ORDER BY id`,
    );
    return rows;
  }

  it("names the owner and the token's id, and never the token", async () => {
    const token = await mint("write");
    const id = token.slice(0, token.indexOf("."));
    await Bun.fetch(`${plane.origin}/trpc/account.tokens.revoke`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    await rawList({ authorization: `Bearer ${token}` });
    const { rows: owner } = await plane.db.query<{ id: string }>(
      "SELECT id::text AS id FROM app.app_user WHERE email = $1",
      [OPERATOR],
    );

    expect(await tokenRefusals()).toEqual([
      {
        tenant_id: null,
        actor: OPERATOR,
        user_id: owner[0]?.id,
        channel: "mcp",
        credential: id,
        outcome: "refused",
        reason: "revoked",
        detail: {},
      },
    ]);
  });

  it("names nobody for a token nobody here issued", async () => {
    await rawList({ authorization: `Bearer upat_nobody00.${"x".repeat(43)}` });

    expect(await tokenRefusals()).toEqual([
      {
        tenant_id: null,
        actor: null,
        user_id: null,
        channel: "mcp",
        credential: null,
        outcome: "refused",
        reason: "unknown",
        detail: {},
      },
    ]);
  });

  it("is not written when no bearer came at all", async () => {
    await rawList({});

    expect(await tokenRefusals()).toEqual([]);
  });
});

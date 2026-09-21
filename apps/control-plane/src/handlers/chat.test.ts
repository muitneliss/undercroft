/**
 * The assistant end to end: a question in, a streamed answer out, a transcript at rest.
 *
 * Through the real router, the real migrations in PGlite, and a scripted model that REFUSES a
 * prompt it has no script for -- so a broken system prompt, an unregistered tool or a transcript
 * restored in the wrong order fails here instead of passing. No mocks
 * (`.claude/rules/tests.md`); the only substituted thing is the token source.
 *
 * The caller is substituted at the `createContext` SEAM rather than by standing in for Better
 * Auth. That is the same split `authz.test.ts` makes -- who may hold a session is
 * `gate.test.ts`'s question, over a real socket, because only that surfaces `Set-Cookie`; who
 * may do what once they hold one is this suite's. It also means no part of this file has to
 * impersonate a library it does not exercise.
 *
 * Route ORDER gets its own test through `createServer`, because it is a property of the app
 * rather than of the route: registered after the SPA catch-all, `/api/assistant/chat` would
 * answer with `index.html`, and `useChat`'s error on a body of HTML is unreadable.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { DEFAULT_LOCALE, type Locale } from "@undercroft/core";
import { migrate } from "@undercroft/db";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { Hono } from "hono";
import { findThread, listTurns } from "../repos/assistantThread.ts";
import { createAssistant } from "../services/assistant/agent.ts";
import { inMemoryLanguageModel, type Turn } from "../services/assistant/model.ts";
import { registerAssistantRoutes } from "./chat.ts";
import { createServer } from "./server.ts";
import type { Context, SessionUser } from "./trpc.ts";

let db: TestDatabase;
let operator: SessionUser;

beforeEach(async () => {
  db = await createTestDatabase();
  await migrate(db);
  await db.query("INSERT INTO ops.tenant (id) VALUES ('CASE-0042'), ('CASE-0043')");
  const { rows } = await db.query<{ id: string }>(
    "INSERT INTO app.app_user (email) VALUES ('ops@example.test') RETURNING id",
  );
  operator = { userId: rows[0]!.id, email: "ops@example.test" };
  await db.query("INSERT INTO app.tenant_member (tenant_id, user_id, role) VALUES ($1, $2, $3)", [
    "CASE-0042",
    operator.userId,
    "admin",
  ]);
  // Seeded as the superuser; from here on every statement runs as the control plane does.
  await db.become("undercroft_app");
});

afterEach(async () => {
  await db.close();
});

function context(user: SessionUser | null, locale: Locale = DEFAULT_LOCALE): Context {
  return {
    exec: db,
    user,
    sessionId: "s1",
    superadmin: false,
    locale,
    endSession: () => Promise.resolve(),
    notifyInvitation: () => Promise.resolve(false),
    startConsent: () => Promise.resolve({ ok: false as const, reason: "not-configured" as const }),
    worker: null,
    googlePicker: null,
  };
}

/** Just the assistant routes, with the caller and the model both injected. */
function appWith(turns: readonly Turn[], ctx: Context = context(operator)): Hono {
  const app = new Hono();
  registerAssistantRoutes(app, {
    exec: db,
    createContext: () => Promise.resolve(ctx),
    assistant: createAssistant(inMemoryLanguageModel(turns)),
  });
  return app;
}

/** The same, with no model configured. */
function appWithoutAssistant(ctx: Context = context(operator)): Hono {
  const app = new Hono();
  registerAssistantRoutes(app, { exec: db, createContext: () => Promise.resolve(ctx) });
  return app;
}

let asked = 0;

async function ask(app: Hono, question: string, tenantId = "CASE-0042"): Promise<Response> {
  // A fresh message id per question, as a browser sends. Reusing one id is not a harmless
  // shortcut: `saveTurn` is idempotent BY that id, so two questions sharing one would
  // deliberately collapse into a single stored turn -- the right behaviour, the wrong fixture.
  asked += 1;
  return await app.fetch(
    new Request("http://undercroft.test/api/assistant/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenantId,
        message: { id: `m${asked}`, role: "user", parts: [{ type: "text", text: question }] },
      }),
    }),
  );
}

interface Frame {
  readonly type: string;
  readonly delta?: string;
}

/** Every SSE frame the route streamed, in order. */
async function frames(response: Response): Promise<readonly Frame[]> {
  const body = await response.text();
  return body
    .split("\n\n")
    .map((chunk) => chunk.replace(/^data: /u, "").trim())
    .filter((line) => line !== "" && line !== "[DONE]")
    .map((line) => JSON.parse(line) as Frame);
}

/**
 * The answer as a reader sees it: the text deltas concatenated.
 *
 * The raw body cannot be searched for a sentence, because a provider streams it in pieces and
 * the scripted model splits deliberately for that reason -- a test that matched a whole sentence
 * in one frame would be asserting something no real provider does.
 */
async function answer(response: Response): Promise<string> {
  return (await frames(response))
    .filter((frame) => frame.type === "text-delta")
    .map((frame) => frame.delta ?? "")
    .join("");
}

async function storedTurns(tenantId = "CASE-0042"): Promise<string> {
  const threadId = await findThread(db, tenantId, operator.userId);
  return JSON.stringify(await listTurns(db, threadId ?? ""));
}

describe("a question is answered", () => {
  it("the answer streams back", async () => {
    const app = appWith([{ when: "hoá đơn", reply: [{ say: "Có 2 hoá đơn đã về." }] }]);
    const response = await ask(app, "Hoá đơn tháng này về chưa?");

    expect(response.status).toBe(200);
    expect(await answer(response)).toBe("Có 2 hoá đơn đã về.");
  });

  it("the exchange is at rest afterwards, question and answer both", async () => {
    const app = appWith([{ when: "hoá đơn", reply: [{ say: "Có 2 hoá đơn đã về." }] }]);
    // The stream must be drained before `onEnd` runs -- persistence is the end of the stream,
    // not the end of the request.
    await (await ask(app, "Hoá đơn tháng này về chưa?")).text();

    const threadId = await findThread(db, "CASE-0042", operator.userId);
    const turns = await listTurns(db, threadId ?? "");
    expect(turns.map((turn) => turn.role)).toEqual(["user", "assistant"]);
    expect(JSON.stringify(turns)).toContain("Có 2 hoá đơn đã về.");
  });

  it("a second question sees the first, because the history is the server's", async () => {
    const app = appWith([
      { when: "hoá đơn", reply: [{ say: "Có 2 hoá đơn đã về." }] },
      { when: "hợp đồng", reply: [{ say: "Chưa có hợp đồng nào." }] },
    ]);
    await (await ask(app, "Hoá đơn tháng này về chưa?")).text();
    await (await ask(app, "Còn hợp đồng?")).text();

    const threadId = await findThread(db, "CASE-0042", operator.userId);
    // Four turns, not two: the model was handed the earlier exchange rather than starting over.
    expect(await listTurns(db, threadId ?? "")).toHaveLength(4);
  });
});

describe("a tool the model calls runs as the reader", () => {
  it("its result reaches the answer, and only a digest comes to rest", async () => {
    const app = appWith([
      { when: "nguồn", reply: [{ call: "sourceStatus", input: { tenantId: "CASE-0042" } }] },
      { when: "nguồn", reply: [{ say: "Chưa có nguồn nào được kết nối." }] },
    ]);
    expect(await answer(await ask(app, "Các nguồn thế nào?"))).toBe(
      "Chưa có nguồn nào được kết nối.",
    );

    // Live, the reader saw the tool's output. At rest it is a digest -- the promise
    // `transcript.ts` exists for, asserted here through the whole route rather than in isolation.
    const stored = await storedTurns();
    expect(stored).toContain("tool-sourceStatus");
    expect(stored).not.toContain('"output":');
  });
});

describe("who may speak, and about what", () => {
  it("an anonymous caller is refused, and told nothing", async () => {
    const response = await ask(appWith([], context(null)), "Hoá đơn?");
    expect(response.status).toBe(401);
    // No body: a sentence here would confirm what an anonymous caller asked about.
    expect(await response.text()).toBe("");
  });

  it("a customer this reader is not in is NOT FOUND, never FORBIDDEN", async () => {
    // The anti-enumeration boundary. A worded refusal would confirm CASE-0043 exists.
    expect((await ask(appWith([]), "Hoá đơn?", "CASE-0043")).status).toBe(404);
  });

  it("nothing is written for a customer the reader may not speak about", async () => {
    await ask(appWith([]), "Hoá đơn?", "CASE-0043");
    // A thread keyed to any tenantId a caller can type would be a write past the boundary.
    expect(await findThread(db, "CASE-0043", operator.userId)).toBeNull();
  });
});

describe("an unconfigured assistant says so, in the reader's language", () => {
  it("a signed-in reader is told it is not set up", async () => {
    const response = await ask(appWithoutAssistant(), "Hoá đơn?");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Trợ lý chưa được cấu hình cho bản triển khai này. Hãy báo người quản trị hệ thống.",
    });
  });

  it("in English for an English reader, since the sentence is theirs to read", async () => {
    const response = await ask(appWithoutAssistant(context(operator, "en")), "Invoices?");
    expect(await response.json()).toEqual({
      error: "The assistant is not set up for this deployment. Tell whoever administers it.",
    });
  });

  it("an anonymous caller is refused BEFORE learning how this deployment is configured", async () => {
    // 401 ahead of 503, deliberately: whether a key is configured is not an anonymous
    // caller's to know.
    expect((await ask(appWithoutAssistant(context(null)), "Hoá đơn?")).status).toBe(401);
  });
});

describe("the scripted model refuses what it was not scripted for", () => {
  it("an unscripted question produces no answer rather than an invented one", async () => {
    const app = appWith([{ when: "hoá đơn", reply: [{ say: "..." }] }]);
    const streamed = await frames(await ask(app, "điều gì khác hoàn toàn"));

    // The status is 200 and cannot be anything else: the refusal happens after the headers are
    // already on the wire, which is true of any mid-stream failure and is why this asserts on
    // the STREAM. What matters is that nothing was invented to fill the gap.
    expect(streamed.some((frame) => frame.type === "error")).toBe(true);
    expect(streamed.some((frame) => frame.type === "text-delta")).toBe(false);
  });
});

describe("the route is registered ahead of the SPA catch-all", () => {
  it("the chat path is not answered with the app shell", async () => {
    // With `uiDist` set, a route registered after the catch-all would return index.html with a
    // 200. The assertion is that it does NOT: an anonymous 401 proves the assistant route won.
    const app = createServer({ exec: db, uiDist: "/nonexistent-dist" });
    const response = await app.fetch(
      new Request("http://undercroft.test/api/assistant/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId: "CASE-0042", message: {} }),
      }),
    );
    expect(response.status).toBe(401);
  });
});

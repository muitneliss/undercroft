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
 * Route ORDER is a property of the app rather than of the route, so it is `server.test.ts`'s:
 * the SPA catch-all is a `GET`, which the history route can lose to and this POST cannot.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { DEFAULT_LOCALE, type Locale } from "@undercroft/core";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { Hono } from "hono";
import { findThread, listTurns } from "../repos/assistantThread.ts";
import { createAssistant } from "../services/assistant/agent.ts";
import { inMemoryJudge, unavailableJudge } from "../services/assistant/judge.ts";
import { inMemoryLanguageModel, type Turn } from "../services/assistant/model.ts";
import { registerAssistantRoutes } from "./chat.ts";
import type { Context, SessionUser } from "./trpc.ts";

let db: TestDatabase;
let operator: SessionUser;

beforeEach(async () => {
  db = await createMigratedTestDatabase();
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
    credentialId: "s1",
    via: "session",
    grant: "write",
    superadmin: false,
    locale,
    endSession: () => Promise.resolve(),
    apps: null,
    notifyInvitation: () => Promise.resolve(false),
    startConsent: () =>
      Promise.resolve({
        ok: false as const,
        reason: "not-configured" as const,
        provider: "google" as const,
      }),
    worker: null,
    googlePicker: null,
  };
}

/**
 * Just the assistant routes, with the caller, the model and the gate all injected.
 *
 * `asksFor` lists the phrases that count as the reader asking for something. A judge that said
 * yes to everything would make the injection test below pass while the gate was open, so the
 * scripted one refuses anything it has no modelled answer for.
 */
function appWith(
  turns: readonly Turn[],
  ctx: Context = context(operator),
  asksFor: readonly string[] = [],
): Hono {
  const app = new Hono();
  registerAssistantRoutes(app, {
    exec: db,
    createContext: () => Promise.resolve(ctx),
    assistant: createAssistant(inMemoryLanguageModel(turns)),
    judge: inMemoryJudge(asksFor),
  });
  return app;
}

/** The same, with no model configured. */
function appWithoutAssistant(ctx: Context = context(operator)): Hono {
  const app = new Hono();
  registerAssistantRoutes(app, {
    exec: db,
    createContext: () => Promise.resolve(ctx),
    judge: unavailableJudge,
  });
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
  /**
   * Present on an approval frame.
   *
   * `isAutomatic` is the field that matters and it cost a round to learn: the SDK models an
   * AUTOMATIC denial as a `tool-approval-request` followed at once by a
   * `tool-approval-response`, so the presence of a request frame says nothing about whether a
   * reader was ever asked. What distinguishes "waiting for the reader" from "refused without
   * them" is that the first has no response frame. The interleaf has to read it the same way.
   */
  readonly approval?: { readonly isAutomatic?: boolean };
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

  it("a customer this reader is not in is NOT FOUND, never FORBIDDEN, and nothing is written", async () => {
    // The anti-enumeration boundary. A worded refusal would confirm CASE-0043 exists.
    expect((await ask(appWith([]), "Hoá đơn?", "CASE-0043")).status).toBe(404);
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

/** A script that goes straight for a mutation, as a model asked to act would. */
const WANTS_TO_RUN: readonly Turn[] = [
  {
    when: "chạy",
    reply: [{ call: "runIngestNow", input: { tenantId: "CASE-0042", source: "xero" } }],
  },
];

describe("a change is proposed, never performed", () => {
  it("reaches approval-requested rather than running", async () => {
    // The whole promise of the write tier. `runs.trigger` would have refused anyway in this
    // suite (no worker), and that is the point: the call must not get far enough to find out.
    //
    // Also the quiet half of the injection test below: the reader DID ask for this, so the
    // gate lets it through to the reader rather than denying it. Without it, a gate that
    // denied everything would satisfy that test while the write tier was dead.
    const app = appWith(WANTS_TO_RUN, context(operator), ["chạy"]);
    const streamed = await frames(await ask(app, "Chạy đồng bộ Xero ngay"));

    const states = streamed.map((frame) => frame.type);
    expect(states).toContain("tool-approval-request");
    // WAITING for the reader, which is the absence of a response frame -- see `Frame.approval`.
    expect(states).not.toContain("tool-approval-response");
    // And nothing ran: no output, no error. The reader has not struck anything yet.
    expect(states).not.toContain("tool-output-available");
    expect(states).not.toContain("tool-output-error");
  });

  it("a read in the same catalogue still runs without one", async () => {
    // The quiet half. If everything needed approval, the test above would pass while the
    // assistant had stopped being able to answer a question.
    const app = appWith(
      [
        { when: "nguồn", reply: [{ call: "sourceStatus", input: { tenantId: "CASE-0042" } }] },
        { when: "nguồn", reply: [{ say: "Xong." }] },
      ],
      context(operator),
      ["nguồn"],
    );
    const streamed = await frames(await ask(app, "Các nguồn thế nào?"));
    expect(streamed.map((frame) => frame.type)).toContain("tool-output-available");
  });
});

describe("data cannot command the assistant", () => {
  /**
   * THE INJECTION TEST, and the reason a classifier is in this codebase at all.
   *
   * The reader asks a question. The model -- having read a landed document that says so --
   * proposes a mutation. The gate is asked whether the READER's own words requested it, sees
   * that they asked about invoices, and denies it. No proof is pulled.
   */
  it("a mutation the reader never asked for is denied, not offered", async () => {
    const app = appWith(
      [
        {
          when: "hoá đơn",
          reply: [{ call: "runIngestNow", input: { tenantId: "CASE-0042", source: "xero" } }],
        },
        { when: "hoá đơn", reply: [{ say: "Bạn chưa yêu cầu việc đó." }] },
      ],
      context(operator),
      // The judge is scripted to recognise only "chạy" (run). The reader said no such thing.
      ["chạy"],
    );
    const streamed = await frames(await ask(app, "Hoá đơn tháng này về chưa?"));

    const states = streamed.map((frame) => frame.type);
    // Denied outright, and the reader is never asked. The SDK still emits a request frame for
    // an automatic decision, so what is asserted is that a RESPONSE came with it -- nobody
    // was waited for -- and that the call ended denied.
    expect(states).toContain("tool-approval-response");
    expect(states).toContain("tool-output-denied");
    // Deliberately not asserting the request frame's own `isAutomatic` flag: the presence of
    // a response alongside it is the signal that nobody was waited for, and it is the one
    // verified here rather than a field shape guessed at. Its counterpart, the same proposal
    // offered because the reader asked for it, is "reaches approval-requested rather than
    // running" above: no response frame there, because a person is being waited for.
  });
});

describe("an unconfigured gate refuses to offer a change", () => {
  it("denies the write tier rather than waving it through", async () => {
    // A gate that fails open is not a gate. An install with a model key but no classifier can
    // answer questions and cannot offer to change anything -- and the model is told why, so it
    // can say so rather than falling silent.
    const app = new Hono();
    registerAssistantRoutes(app, {
      exec: db,
      createContext: () => Promise.resolve(context(operator)),
      assistant: createAssistant(inMemoryLanguageModel(WANTS_TO_RUN)),
      judge: unavailableJudge,
    });
    const streamed = await frames(await ask(app, "Chạy đồng bộ Xero ngay"));

    const states = streamed.map((frame) => frame.type);
    expect(states).toContain("tool-output-denied");
    // Refused without asking anybody, which is the shape of an automatic decision.
    expect(states).toContain("tool-approval-response");
  });
});

describe("a privileged change is held to the same gate, plus one", () => {
  it("revoking a grant reaches approval-requested and no further", async () => {
    // The blast radius here is a customer's source going dark until a human at Google
    // reconnects it, so the server-side promise is the same as the write tier's -- it must not
    // run -- and the panel adds the typed confirmation on top (`assistantProofs.test.ts`).
    const app = appWith(
      [
        {
          when: "ngắt",
          reply: [{ call: "revokeGrant", input: { tenantId: "CASE-0042", source: "xero" } }],
        },
      ],
      context(operator),
      ["ngắt"],
    );
    const states = (await frames(await ask(app, "Ngắt kết nối Xero"))).map((f) => f.type);

    expect(states).toContain("tool-approval-request");
    expect(states).not.toContain("tool-approval-response");
    expect(states).not.toContain("tool-output-available");
    // Who may run it once struck is still the router's, not the tier's: a viewer's bound tool
    // is refused FORBIDDEN by the procedure itself, pinned in `assistantTools.test.ts`.
  });
});

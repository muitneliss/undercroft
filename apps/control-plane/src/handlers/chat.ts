/**
 * `/api/assistant/*`: the one transport that is not tRPC, because a stream is not a procedure.
 *
 * tRPC over `httpBatchLink` answers with a JSON body when the call finishes, which is the wrong
 * shape for an answer the reader watches arrive. So this is a plain Hono route returning the AI
 * SDK's UI message stream, and it is the only non-tRPC, non-OAuth surface in the control plane.
 *
 * It does NOT get its own idea of who is calling. `createContext` is passed in and is the same
 * function `/trpc` uses, and every tool it binds goes through `appRouter.createCaller` -- so the
 * assistant reaches exactly the procedures the reader could have clicked, under the same
 * middleware. See `assistantTools.ts`.
 *
 * WHY THE BROWSER SENDS ONE MESSAGE AND NOT THE TRANSCRIPT. The history is rebuilt here from
 * `app.assistant_turn`. If the client posted the whole conversation, a tampered body could put
 * words in the reader's mouth -- "yes, revoke it" attributed to them -- and the model would have
 * no way to tell. The browser is trusted for exactly one thing: the sentence just typed.
 *
 * `AssistantRouteDeps` is declared here rather than imported from `server.ts`, following
 * `registerOAuthRoutes`: `server.ts` imports this file, so importing `ServerDeps` back out of it
 * would be a cycle (and `noImportCycles` is on).
 */

import type { SqlExecutor } from "@undercroft/db";
import {
  createUIMessageStreamResponse,
  generateId,
  toUIMessageStream,
  type UIMessage,
  validateUIMessages,
} from "ai";
import type { Context as HonoContext, Hono } from "hono";
import { messages as catalogue } from "../i18n/index.ts";
import type { Assistant, Responded } from "../services/assistant/agent.ts";
import { inputSchemas, summarizeFor, type Tier } from "../services/assistant/catalogue.ts";
import { history, remember, resume } from "../services/assistant/conversation.ts";
import { bindTools } from "./assistantTools.ts";
import type { Context } from "./trpc.ts";
import { appRouter } from "./router.ts";

/**
 * The tiers this route binds.
 *
 * `read` only, for now: everything the assistant can reach is something the caller could have
 * read by clicking. The write tiers arrive with the proof slip that confirms them, and until
 * that exists an unbound tool is a stronger guarantee than a bound one that asks nicely.
 */
const TIERS: readonly Tier[] = ["read"];

export interface AssistantRouteDeps {
  readonly exec: SqlExecutor;
  /** The same context `/trpc` builds. One definition of who is asking. */
  readonly createContext: (headers: Headers) => Promise<Context>;
  /** Absent means no model is configured; the routes then refuse in the caller's language. */
  readonly assistant?: Assistant;
}

interface ChatBody {
  readonly tenantId: string;
  readonly message: unknown;
}

function isChatBody(body: unknown): body is ChatBody {
  return (
    body !== null &&
    typeof body === "object" &&
    "tenantId" in body &&
    typeof body.tenantId === "string" &&
    body.tenantId.length > 0 &&
    "message" in body
  );
}

/**
 * Establish that this reader may speak about this customer, and with what authority.
 *
 * Through `tenants.get`, which is `tenantProcedure` -- so a non-member gets NOT_FOUND and
 * learns nothing about whether the customer exists, exactly as everywhere else. Asking the
 * repo directly here would have been a second copy of that decision, and the one that forgot
 * that a superadmin holds admin without a `tenant_member` row.
 *
 * It also yields the role, which the prompt needs in order to tell the reader what they can do.
 */
async function authority(ctx: Context, tenantId: string): Promise<{ role: string } | null> {
  try {
    const tenant = await appRouter.createCaller(ctx).tenants.get({ tenantId });
    return { role: tenant.role };
  } catch {
    return null;
  }
}

/** Asia/Singapore, always. A locale never moves a timestamp -- `.claude/rules/i18n.md`. */
function nowInSingapore(): string {
  return new Date().toLocaleString("sv-SE", { timeZone: "Asia/Singapore" });
}

/**
 * Everything that must be true before a model is called, or the response that says why not.
 *
 * Separated from answering because the two read very differently: this is a sequence of
 * refusals in a deliberate order -- anonymity BEFORE configuration, so an anonymous caller
 * cannot learn whether a key is set -- and that order is the security-relevant part.
 */
type Admitted =
  | {
      readonly ok: true;
      readonly assistant: Assistant;
      readonly body: ChatBody;
      readonly role: string;
    }
  | { readonly ok: false; readonly response: Response };

async function admit(c: HonoContext, deps: AssistantRouteDeps, ctx: Context): Promise<Admitted> {
  const t = catalogue(ctx.locale);

  // No message on a 401, deliberately: `trpc.ts` words refusals only past the membership
  // boundary, because a sentence here would confirm what an anonymous caller asked about.
  if (ctx.user === null) {
    return { ok: false, response: c.body(null, 401) };
  }

  const { assistant } = deps;
  if (assistant === undefined) {
    // 503 and a sentence: this one IS the reader's to know about. An unconfigured assistant is
    // an operator's missing key, not a permission boundary, and saying so is how they find out
    // rather than watching a panel fail silently.
    return { ok: false, response: c.json({ error: t("error.assistantUnconfigured") }, 503) };
  }

  const body: unknown = await c.req.json().catch(() => null);
  if (!isChatBody(body)) {
    return { ok: false, response: c.json({ error: t("error.assistantBadRequest") }, 400) };
  }

  const held = await authority(ctx, body.tenantId);
  if (held === null) {
    return { ok: false, response: c.body(null, 404) };
  }

  return { ok: true, assistant, body, role: held.role };
}

/**
 * The answer on the wire, and the transcript behind it.
 *
 * Separated from the route because it is the one part with a non-obvious ordering requirement:
 * persistence happens at the END OF THE STREAM, not the end of the request handler, so it has
 * to be expressed as a callback rather than as the next statement.
 */
function streamed(
  result: Responded,
  messages: readonly UIMessage[],
  save: (finished: readonly UIMessage[]) => Promise<void>,
): Response {
  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: [...messages],
      // WITHOUT THIS the assistant's message reaches `onEnd` with no id, and `assistant_turn`'s
      // length check on `message_id` refuses the row -- a failure that surfaces as a truncated
      // stream rather than as an error, because by then the response has been a 200 for some
      // time. The turn is keyed by this id (that is what makes re-saving idempotent), so it has
      // to be generated where the turn is built.
      generateMessageId: generateId,
      // Reasoning is not sent to the browser at all. It is dropped from the transcript for
      // quoting tool results freely (`transcript.ts`), and streaming it live while refusing to
      // keep it would be two answers to one question.
      sendReasoning: false,
      onEnd: ({ messages: finished }) => save(finished),
    }),
  });
}

export function registerAssistantRoutes(app: Hono, deps: AssistantRouteDeps): void {
  /**
   * The conversation so far, so a reload does not look like a fresh start.
   *
   * Digested tool results come back as digests, which is what the reader sees: the figure they
   * saw live is not re-fetched behind their back, and the panel says the result is not kept
   * rather than showing a stale one. See `transcript.ts`.
   */
  app.get("/api/assistant/history", async (c) => {
    const ctx = await deps.createContext(c.req.raw.headers);
    if (ctx.user === null) {
      return c.body(null, 401);
    }
    const tenantId = c.req.query("tenantId") ?? "";
    if (tenantId === "" || (await authority(ctx, tenantId)) === null) {
      return c.body(null, 404);
    }

    return c.json({ messages: await history(deps.exec, tenantId, ctx.user.userId) });
  });

  app.post("/api/assistant/chat", async (c) => {
    const ctx = await deps.createContext(c.req.raw.headers);
    const admitted = await admit(c, deps, ctx);
    if (!admitted.ok) {
      return admitted.response;
    }
    const { assistant, body, role } = admitted;
    // Narrowed by `admit`, which refuses an anonymous caller before anything else.
    const userId = ctx.user?.userId ?? "";

    const conversation = await resume(deps.exec, body.tenantId, userId);
    if (conversation.full) {
      return c.json({ error: catalogue(ctx.locale)("error.assistantThreadFull") }, 429);
    }

    // The history is the SERVER'S, and the browser contributes one message. Both halves then go
    // through the SDK's validator together: a row written by an older shape of the transcript is
    // a real possibility, and refusing it here beats handing it to the model.
    const tools = bindTools(ctx, { tiers: TIERS });
    const messages = await validateUIMessages({
      messages: [...conversation.messages, body.message],
      tools: inputSchemas(TIERS),
    });

    const result = await assistant.respond({
      messages,
      tools,
      facts: {
        locale: ctx.locale,
        tenantId: body.tenantId,
        role: role === "viewer" || role === "member" || role === "admin" ? role : null,
        superadmin: ctx.superadmin,
        now: nowInSingapore(),
      },
    });

    return streamed(result, messages, (finished) =>
      remember(deps.exec, conversation.threadId, finished, summarizeFor),
    );
  });
}

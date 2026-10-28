/**
 * What of an agent's call `ops.call_log` keeps, procedure by procedure (ADR 0151): a fact about a
 * procedure the router cannot answer, kept beside the others in `surface.ts` and typed against it
 * the same way -- total over every procedure, so a new one is a `tsc` error until somebody
 * decides what its answer may leave in the control plane's database.
 *
 * And the one function both doors that write a row call -- the router's middleware (`trpc.ts`)
 * and `/mcp`'s refusal before the router (`mcp.ts`) -- so the rule, the door check and the error
 * as the server saw it are decided once.
 */

import type { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import { currentTraceId } from "@undercroft/telemetry";
import {
  type CallError,
  type CallOutcome,
  type PayloadRule,
  recordCallPayload,
  type ResponseKept,
} from "../services/callLog.ts";
import type { Actor } from "../services/audit.ts";
import { namedTenant } from "./audited.ts";
import type { InputOf, OutputOf, ProcedurePath } from "./surface.ts";
import type { Context } from "./trpc.ts";

/** The top-level fields of a value, the only thing an entry may name. */
type FieldOf<T> = T extends readonly unknown[]
  ? never
  : T extends object
    ? keyof T & string
    : never;

/**
 * What a row keeps of one procedure's call. The request is always kept, cut at the cap, and the
 * error with its real cause; what varies is the answer:
 *
 * - `whole`: all of it, every key on the deep deny-list of secrets redacted (`services/callLog.ts`).
 * - `shape`: its columns, how many rows, and the notes beside them -- never a cell. For every
 *   answer that carries a customer's rows, a raw payload, document text or an excerpt of it, a
 *   folder or a label a person named: what the control plane's login is denied, or what
 *   `pii.md` keeps out of Postgres, must not reach it as a copy here (ADR 0026 section 3).
 * - `none`: nothing; for an answer that is this log, so reading it does not write it again.
 * - `{ input, output }`: whole, with these fields of the request or the answer redacted. Typed
 *   against the procedure, so a renamed secret field is a `tsc` error; the deep deny-list would
 *   catch most, and this states which field IS the secret where the procedure is defined.
 */
export type Kept<P extends ProcedurePath> =
  | ResponseKept
  | {
      readonly input?: readonly FieldOf<InputOf<P>>[];
      readonly output?: readonly FieldOf<OutputOf<P>>[];
    };

export type PayloadTable = { readonly [P in ProcedurePath]: Kept<P> };

export const PAYLOAD_KEPT: PayloadTable = {
  health: "whole",
  "config.google": "whole",
  "config.signIn": "whole",

  "session.me": "whole",
  "session.signOut": "whole",
  "session.setLocale": "whole",

  "account.tokens.list": "whole",
  // The token is returned this once; a row that kept it would be a second copy of a credential.
  "account.tokens.mint": { output: ["token"] },
  "account.tokens.revoke": "whole",
  "account.apps.list": "whole",
  "account.apps.revoke": "whole",

  "tenants.list": "whole",
  "tenants.get": "whole",
  "tenants.create": "whole",
  "tenants.rename": "whole",
  "tenants.deactivate": "whole",
  "tenants.reactivate": "whole",

  "connections.list": "whole",
  "connections.get": "whole",
  "connections.startOAuth": "whole",
  // The names of a customer's folders, labels and files, as a person wrote them: `pii.md` keeps a
  // folder's name out of Postgres, and a listing is every one of them.
  "connections.browseScope": "shape",
  "connections.setScope": "whole",
  // A source's own credential, pasted by an admin.
  "connections.setToken": { input: ["token"] },
  "connections.setCadence": "whole",
  "connections.setResync": "whole",
  "connections.disconnect": "whole",

  "keys.list": "whole",
  // An ingest key's token, returned this once.
  "keys.mint": { output: ["token"] },
  "keys.revoke": "whole",

  "people.members": "whole",
  "people.invitations": "whole",
  "people.invite": "whole",
  "people.revokeInvitation": "whole",
  "people.setRole": "whole",
  "people.removeMember": "whole",

  "roles.list": "whole",
  "roles.get": "whole",
  "roles.save": "whole",
  "roles.delete": "whole",
  "grants.list": "whole",
  "grants.save": "whole",
  "grants.delete": "whole",
  "grants.reach": "whole",
  "scopes.preview": "whole",

  "audit.mine": "whole",
  "audit.tenant": "whole",
  "audit.all": "whole",
  // This log itself: reading a call must not store its request and answer a second time.
  "audit.calls.list": "none",
  "audit.calls.get": "none",

  // Counts and freshness per stream.
  "lake.summary": "whole",
  // A raw payload is the source's data verbatim.
  "lake.records": "shape",
  // Opaque ids, content types, sizes and hashes: what `raw.documents` holds, by `pii.md`'s rule.
  "lake.documents": "whole",
  // Any SELECT over raw, `raw.document_text.text` included.
  "lake.query": "shape",
  // Each hit carries an excerpt of a record or a document's text (ADR 0026).
  "lake.search": "shape",
  // Table and column names.
  "lake.querySchema": "whole",

  "documentKinds.list": "whole",
  "documentKinds.add": "whole",
  "documentKinds.update": "whole",
  "documentKinds.remove": "whole",
  "documentKinds.initialise": "whole",
  "documentKinds.publish": "whole",

  "models.list": "whole",
  "models.revision": "whole",
  "models.get": "whole",
  "models.save": "whole",
  "models.delete": "whole",
  // The run's verdict, steps and counts are kept; its preview is the model's rows.
  "models.build": { output: ["preview"] },
  "models.lineage": "whole",
  "models.reference": "whole",
  "models.check": "whole",
  // A model's rows, read from the customer's analytics.
  "models.preview": "shape",

  "macros.list": "whole",
  "macros.get": "whole",
  "macros.check": "whole",
  "macros.save": "whole",
  "macros.delete": "whole",

  "seeds.list": "whole",
  // Every cell of a reference table a customer wrote.
  "seeds.get": "shape",
  "seeds.save": "whole",
  "seeds.delete": "whole",

  // Rows of a customer's analytics, as their BI login reads them.
  "bi.answer": "shape",
  "bi.runQuestion": "shape",
  "bi.compile": "whole",
  "bi.schema": "whole",
  "bi.questions.list": "whole",
  "bi.questions.get": "whole",
  "bi.questions.answer": "shape",
  "bi.questions.save": "whole",
  "bi.questions.delete": "whole",
  "bi.dashboards.list": "whole",
  "bi.dashboards.get": "whole",
  "bi.dashboards.save": "whole",
  "bi.dashboards.delete": "whole",
  // A link and a file name; the rows are taken by the download route, not by a procedure.
  "bi.exports.create": "whole",
  "bi.exports.get": "whole",

  // The rows a failed test stored: source data, which `dq_<slug>` exists to keep off dashboards.
  "dq.failures": "shape",

  "runs.list": "whole",
  "runs.get": "whole",
  "runs.events": "whole",
  "runs.trigger": "whole",
};

const RULES: ReadonlyMap<string, Kept<ProcedurePath>> = new Map(Object.entries(PAYLOAD_KEPT));

/**
 * A procedure's entry as the service reads it, off a path held as a string. A path the table
 * does not know -- unreachable, by its type -- keeps no answer: the direction that leaks nothing.
 */
export function payloadRuleOf(path: string): PayloadRule {
  const kept = RULES.get(path) ?? "none";
  if (typeof kept === "string") {
    return { response: kept, input: [], output: [] };
  }
  return { response: "whole", input: kept.input ?? [], output: kept.output ?? [] };
}

/**
 * A refusal or a failure as the server saw it: the code, the status, the message and facts the
 * caller was given, and -- the reason this row exists -- the exception underneath, which the
 * caller of a 500 was told only as `internal_error`. Server-side only; nothing here reaches the
 * wire.
 */
export function errorOf(
  error: TRPCError,
  facts: Readonly<Record<string, string | null>> | null,
): CallError {
  const { cause } = error;
  return {
    code: error.code,
    status: getHTTPStatusCodeFromError(error),
    message: error.message,
    facts,
    cause:
      cause instanceof Error && cause !== error
        ? { name: cause.name, message: cause.message, stack: cause.stack ?? null }
        : null,
  };
}

/**
 * Keep one call, when it came through an agent's door: the CLI, `/mcp` or the assistant. The
 * browser's never -- it polls, and an agent's calls would drown (ADR 0120's reason).
 *
 * Independent of the audit row and of who writes it: an action a service records is kept here
 * too, because what an agent sent is the question this log answers and the audit log does not.
 */
export async function keepCall(
  ctx: Pick<Context, "exec" | "channel" | "log">,
  call: {
    readonly actor: Actor & { readonly userId: string };
    readonly path: string;
    readonly type: "query" | "mutation";
    readonly raw: unknown;
    readonly durationMs: number | null;
    readonly answer: unknown;
    readonly error: CallError | null;
    readonly outcome: CallOutcome;
    readonly reason: string | null;
  },
): Promise<void> {
  const { channel } = ctx;
  if (channel === "web") {
    return;
  }
  await recordCallPayload(
    ctx.exec,
    {
      traceId: currentTraceId() ?? null,
      tenantId: namedTenant(call.raw),
      actor: {
        userId: call.actor.userId,
        email: call.actor.email,
        channel,
        credential: call.actor.credential,
      },
      path: call.path,
      type: call.type,
      outcome: call.outcome,
      reason: call.reason,
      durationMs: call.durationMs,
      request: call.raw,
      response: call.answer,
      error: call.error,
      rule: payloadRuleOf(call.path),
    },
    ctx.log,
  );
}

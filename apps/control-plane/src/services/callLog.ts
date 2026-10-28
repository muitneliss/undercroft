/**
 * An agent's call kept whole for a platform superadmin, for 30 days (ADR 0151): writing one, for
 * every door that does -- the router's middleware and `/mcp`'s refusal before the router -- and
 * reading them back.
 *
 * What a body becomes -- no secret, no cell where the answer is a shape, no more than 256 KB --
 * is `callBody.ts`'s. What is decided here is the row around it, and its lifetime: every
 * thousandth row sweeps rows older than {@link CALL_LOG_RETENTION_DAYS} days, so the table is
 * bounded without a second moving part to schedule.
 *
 * And it never throws. The call has already been answered; a failed insert turned into a failed
 * call would read to the agent as an outage of the procedure it called. A failure is logged as
 * `call_log_failed` with the error's type alone -- its message may quote the row that caused it
 * (ADR 0021) -- and the call's answer stands.
 */

import { describeError, type Logger } from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";
import {
  type CallChannel,
  type CallDetail,
  type CallFilter,
  type CallOutcome,
  type CallSummary,
  get,
  insert,
  list,
  pruneOlderThan,
  type ResponseKept,
} from "../repos/callLog.ts";
import { type CallError, storedError, storedRequest, storedResponse } from "./callBody.ts";

export type { CallError } from "./callBody.ts";
export type {
  CallChannel,
  CallDetail,
  CallOutcome,
  CallSummary,
  ResponseKept,
} from "../repos/callLog.ts";

/** How long a row is kept. ADR 0151. */
export const CALL_LOG_RETENTION_DAYS = 30;

/** One row in this many sweeps the table: often enough to bound it, rarely enough to cost nothing. */
const SWEEP_EVERY = 1000;

/** Which of a procedure's request and answer a row keeps (its entry in `callPayload.ts`). */
export interface PayloadRule {
  readonly response: ResponseKept;
  /** Top-level input fields redacted. */
  readonly input: readonly string[];
  /** Top-level answer fields redacted. */
  readonly output: readonly string[];
}

export interface Call {
  readonly traceId: string | null;
  readonly tenantId: string | null;
  readonly actor: {
    readonly userId: string;
    readonly email: string;
    readonly channel: CallChannel;
    readonly credential: string | null;
  };
  readonly path: string;
  readonly type: "query" | "mutation";
  readonly outcome: CallOutcome;
  readonly reason: string | null;
  readonly durationMs: number | null;
  /** The input as it was sent, before any parse. */
  readonly request: unknown;
  /** The answer, or `undefined` for a call that was not answered. */
  readonly response: unknown;
  readonly error: CallError | null;
  readonly rule: PayloadRule;
}

/** Keep one call. Never throws; see the module's note. */
export async function recordCallPayload(
  exec: SqlExecutor,
  call: Call,
  log?: Logger,
): Promise<void> {
  try {
    const id = await insert(exec, {
      traceId: call.traceId,
      tenantId: call.tenantId,
      userId: call.actor.userId,
      actor: call.actor.email,
      channel: call.actor.channel,
      credential: call.actor.credential,
      path: call.path,
      type: call.type,
      outcome: call.outcome,
      reason: call.reason,
      durationMs: call.durationMs,
      request: storedRequest(call.request, call.rule.input),
      responseKept: call.rule.response,
      response: storedResponse(call.response, call.rule.response, call.rule.output),
      error: call.error === null ? null : storedError(call.error),
    });
    if (id !== "" && BigInt(id) % BigInt(SWEEP_EVERY) === 0n) {
      const removed = await pruneOlderThan(exec, CALL_LOG_RETENTION_DAYS);
      log?.info("call_log_pruned", { removed });
    }
  } catch (error) {
    log?.error("call_log_failed", { path: call.path, errorType: describeError(error).errorType });
  }
}

/** A page of calls, newest first, and the id to ask for the next page from. */
export interface CallPage {
  readonly items: readonly CallSummary[];
  readonly nextCursor: string | null;
}

/** Every call matching the filter, a page at a time, without their bodies. */
export async function listCalls(
  exec: SqlExecutor,
  input: Omit<CallFilter, "before" | "limit"> & { cursor?: string | undefined; limit: number },
): Promise<CallPage> {
  const { cursor, limit, ...filter } = input;
  // One row past the page says whether there is another, without counting the table.
  const rows = await list(exec, { ...filter, before: cursor, limit: limit + 1 });
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last !== undefined ? last.id : null };
}

/** One call whole, or `null` for one there is not -- never written, or swept. */
export function getCall(exec: SqlExecutor, id: string): Promise<CallDetail | null> {
  return get(exec, id);
}

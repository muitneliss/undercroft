/**
 * How a refusal is worded, and what a save answers with.
 *
 * Their own module because three sub-routers need them and none of them owns them -- keeping
 * them in `router.ts` made every sub-router import its own parent, which is a cycle.
 */

import { TRPCError } from "@trpc/server";
import type { QueryParams, TableResult } from "@undercroft/contracts";
import type { Locale } from "@undercroft/core/locale";
import { messages } from "../i18n/index.ts";
import * as bi from "../services/bi.ts";
import type { Context } from "./trpc.ts";

/** Which sentence a refused pasted token gets: the token is wrong, the source cannot, or the worker would not. */
export function tokenRefusalKey(
  reason: "rejected" | "unsupported-source" | "refused",
): "error.tokenRejected" | "error.sourceNotConnectable" | "error.tokenNotStored" {
  switch (reason) {
    case "rejected":
      return "error.tokenRejected";
    case "unsupported-source":
      return "error.sourceNotConnectable";
    case "refused":
      return "error.tokenNotStored";
    default: {
      const exhaustive: never = reason;
      throw new Error(`unhandled refusal ${String(exhaustive)}`);
    }
  }
}
/**
 * Which refusal a question that was not answered gets. A parameter with no value and SQL
 * Postgres refused are both BAD_REQUEST -- the request was the fault, and the sentence says
 * what to change -- while a worker that did not answer is a precondition nobody at the
 * screen can fix.
 */
export function answerRefusal(
  locale: Locale,
  outcome: Exclude<bi.AnswerOutcome, { ok: true }>,
): TRPCError {
  switch (outcome.reason) {
    case "param-missing":
      return new TRPCError({
        code: "BAD_REQUEST",
        message: messages(locale)("error.paramMissing", { name: outcome.param }),
      });
    case "query-failed":
      return new TRPCError({
        code: "BAD_REQUEST",
        message: messages(locale)("error.queryFailed", { message: outcome.message ?? "" }),
      });
    case "question-not-found":
      return new TRPCError({ code: "NOT_FOUND" });
    default:
      return new TRPCError({
        code: "PRECONDITION_FAILED",
        message: messages(locale)("error.queryNotRun"),
      });
  }
}
/** A saved question answered through the worker, or the refusal it earns. */
export async function answerSaved(
  ctx: Pick<Context, "exec" | "worker" | "locale">,
  input: { tenantId: string; questionId: string; params: QueryParams },
): Promise<TableResult> {
  if (ctx.worker === null) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: messages(ctx.locale)("error.workerUnavailable"),
    });
  }
  const outcome = await bi.answerQuestion(ctx.exec, ctx.worker, input);
  if (!outcome.ok) {
    throw answerRefusal(ctx.locale, outcome);
  }
  return outcome.value;
}

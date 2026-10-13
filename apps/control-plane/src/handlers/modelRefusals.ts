/**
 * How the `models` procedures word a refusal that carries facts: a build another build holds, a
 * build whose parent's tests failed, a preview whose model or SQL was refused.
 *
 * Apart from `modelsRouter.ts`, which had reached its line ceiling, for the reason
 * `checkWords.ts` is apart: the sentence a person reads and the facts an agent matches on are one
 * decision, and each refusal's two halves are read together here.
 */

import type { TRPCError } from "@trpc/server";
import type { Locale } from "@undercroft/core/locale";
import { messages } from "../i18n/index.ts";
import { formatWhen } from "../services/alertWording.ts";
import type { ParentTests } from "../services/buildGuard.ts";
import type { BuildHolder } from "../services/modelBuild.ts";
import type { WorkerFailure } from "../services/workerRefusals.ts";
import { notRun } from "./answers.ts";
import { refusal } from "./trpc.ts";

/**
 * A build refused because one is already running: CONFLICT, with the holder's run and start as
 * facts an agent waits on (`runs.get` with `waitSeconds`) and in the sentence a person reads.
 * A holder the ledger no longer has -- it finished between the refusal and the read -- is not
 * named, and the sentence says only that a build was running.
 */
export function buildHeld(locale: Locale, holder: BuildHolder | null): TRPCError {
  const t = messages(locale);
  if (holder === null) {
    return refusal("CONFLICT", t("error.buildInProgress"), {
      reason: "BUILD_IN_PROGRESS",
      runId: null,
      startedAt: null,
    });
  }
  return refusal(
    "CONFLICT",
    t("error.buildInProgressAs", {
      runId: holder.runId,
      startedAt: formatWhen(holder.startedAt, locale),
    }),
    { reason: "BUILD_IN_PROGRESS", runId: holder.runId, startedAt: holder.startedAt },
  );
}

/**
 * A build refused because a parent it would read without rebuilding has failing tests (issue
 * 457): PRECONDITION_FAILED, since the fix is upstream of the request. The sentence names the
 * first such parent, its failing tests and the run, and the way on -- fix and rebuild it, or
 * build `+name`; the facts carry every failing parent, comma-joined, for an agent.
 */
export function parentTestsFailing(locale: Locale, failing: readonly ParentTests[]): TRPCError {
  const [first] = failing;
  const tests = first?.tests.failingTests.map((test) => test.name) ?? [];
  const parent = first?.parent ?? "";
  const model = first?.readBy[0] ?? "";
  const runId = first?.tests.runId ?? null;
  return refusal(
    "PRECONDITION_FAILED",
    messages(locale)("error.buildParentTestsFailing", {
      model,
      parent,
      tests: tests.join(", "),
      runId: runId ?? "",
    }),
    {
      reason: "PARENT_TESTS_FAILING",
      model,
      parent,
      tests: tests.join(","),
      runId,
      parents: failing.map((p) => p.parent).join(","),
    },
  );
}

/**
 * A preview that did not answer (ADR 0132). A model dbt would not compile and SQL Postgres
 * refused are BAD_REQUEST quoting dbt or Postgres -- the request was the fault, and the quote is
 * how the author fixes it -- told apart by their facts, since the author fixes them in different
 * places. A worker that did not answer is a precondition nobody at the screen can fix.
 */
export function previewRefused(
  locale: Locale,
  name: string,
  outcome: { readonly reason: WorkerFailure; readonly message?: string },
): TRPCError {
  const t = messages(locale);
  switch (outcome.reason) {
    case "compile-failed":
      return refusal(
        "BAD_REQUEST",
        t("error.previewCompileFailed", { name, cause: outcome.message ?? "" }),
        { reason: "COMPILE_FAILED" },
      );
    case "query-failed":
      return refusal("BAD_REQUEST", t("error.queryFailed", { message: outcome.message ?? "" }), {
        reason: "QUERY_FAILED",
      });
    default:
      return notRun(locale, outcome.reason, "error.previewNotRun");
  }
}

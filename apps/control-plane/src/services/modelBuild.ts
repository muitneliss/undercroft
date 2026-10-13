/**
 * Building a customer's models: some of them, as one run, through the worker (issue 442).
 *
 * Its own module beside `models.ts` because a build is the one verb on a model that decides
 * three things before and after the worker: that every model the selection names is the
 * tenant's, who holds the build lock when the worker refuses, and how the steps it answers with
 * are reported (`stepReport.ts`, issue 441). `models.ts` stores and reads; this runs.
 */

import { type ModelRowCount, selectedModel, type TableResult } from "@undercroft/contracts";
import { type RunVerdict, runVerdict } from "@undercroft/contracts/runs";
import type { SqlExecutor } from "@undercroft/db";
import { getRun, listModels } from "@undercroft/db/repos";

import { type Actor, record as recordAudit } from "../repos/auditLog.ts";
import { guardParents, type ParentTests } from "./buildGuard.ts";
import { reportSteps, type StepQuery, type StepReport } from "./stepReport.ts";
import type { WorkerClient } from "./workerClient.ts";
import type { WorkerFailure } from "./workerRefusals.ts";

/**
 * What a build answers: once waited for, what it did -- its steps as a summary and the page
 * asked for, the named models' row counts, the one model's first rows -- or, not waited for,
 * the run doing it, which `runs.get` waits on.
 */
export type BuildView = (
  | { readonly waited: false; readonly runId: string; readonly verdict: "running" }
  | ({
      readonly waited: true;
      readonly runId: string;
      readonly ok: boolean;
      /**
       * `clean`, `tests-failing` or `failed` (ADR 0129). `ok` with failing tests is a build
       * whose tables are written and served with rows its tests refused: success is `clean`.
       */
      readonly verdict: RunVerdict;
      readonly testsFailed: number;
      readonly error: string | null;
      readonly rowCounts: ModelRowCount[];
      readonly preview: TableResult | null;
    } & StepReport)
) & {
  /**
   * Parents this build read without building whose tests are unknown -- none recorded, or never
   * built -- by name. Not a refusal and not a pass: their rows went into this build untested.
   */
  readonly parentTestsUnknown: readonly string[];
};

/** The run that holds the tenant's build lock, as the ledger has it. */
export interface BuildHolder {
  readonly runId: string;
  readonly startedAt: string;
}

export type BuildOutcome =
  | { readonly ok: true; readonly value: BuildView }
  /** Models the selection names that the tenant does not have, deduplicated, in order named. */
  | { readonly ok: false; readonly reason: "not-found"; readonly missing: string[] }
  /** A parent the build would read without building has failing tests (issue 457). */
  | {
      readonly ok: false;
      readonly reason: "parent-tests-failing";
      readonly failing: readonly ParentTests[];
    }
  /** `null` when the holder could not be named: it finished, or the worker did not say. */
  | { readonly ok: false; readonly reason: "in-progress"; readonly holder: BuildHolder | null }
  | { readonly ok: false; readonly reason: Exclude<WorkerFailure, "in-progress"> };

/**
 * Build some models as one run through the worker (issue 442), and wait unless asked not to.
 *
 * Every model the selection names must be one the tenant has, checked here before anything
 * runs: dbt answers a selector that matches nothing with a green build of nothing, and that
 * would reach the caller as a success. Then the parents it would read without building are read
 * for their latest tests, and one failing refuses the build (`buildGuard.ts`, issue 457): a build
 * of one model must not publish the rows its parent's tests just refused. A build already
 * running is refused by the worker's lock, and the refusal is given the holder's start from the
 * ledger, so whoever asked can wait on that run instead of guessing when to retry.
 *
 * The steps the worker returns are reported as `runs.get` reports them (`stepReport.ts`): the
 * summary of every step, then the page `steps` asks for. The cursor of that page is the run's,
 * and `runs.get` on the same run continues it -- a build is not re-run to read a second page.
 *
 * The audit row names the selection and the run, never SQL; the run itself is in the ledger.
 */
export async function buildModels(
  exec: SqlExecutor,
  worker: WorkerClient,
  input: {
    tenantId: string;
    select: readonly string[];
    wait: boolean;
    steps: StepQuery;
    actor: Actor;
    actorId: string;
  },
): Promise<BuildOutcome> {
  const known = new Set((await listModels(exec, input.tenantId)).map((model) => model.name));
  const missing = [...new Set(input.select.map(selectedModel))].filter((name) => !known.has(name));
  if (missing.length > 0) {
    return { ok: false, reason: "not-found", missing };
  }
  const guard = await guardParents(exec, input.tenantId, input.select);
  if (!guard.ok) {
    return { ok: false, reason: "parent-tests-failing", failing: guard.failing };
  }
  const outcome = await worker.buildModels({
    tenantId: input.tenantId,
    select: input.select,
    wait: input.wait,
    triggeredBy: input.actorId,
  });
  if (!outcome.ok) {
    if (outcome.reason === "in-progress") {
      return { ok: false, reason: "in-progress", holder: await holderOf(exec, input, outcome) };
    }
    return outcome;
  }
  const answer = outcome.value;
  await recordAudit(exec, {
    tenantId: input.tenantId,
    actor: input.actor,
    action: "models.build",
    detail: JSON.stringify({
      names: input.select,
      runId: answer.runId,
      waited: answer.waited,
      ...(answer.waited ? { ok: answer.ok } : {}),
    }),
  });
  if (!answer.waited) {
    return {
      ok: true,
      value: { ...answer, verdict: "running", parentTestsUnknown: guard.unknown },
    };
  }
  return {
    ok: true,
    value: {
      waited: true,
      runId: answer.runId,
      ok: answer.ok,
      verdict: runVerdict(answer.ok ? "ok" : "failed", answer.testsFailed),
      testsFailed: answer.testsFailed,
      error: answer.error,
      ...reportSteps(answer.steps, input.steps),
      rowCounts: answer.rowCounts,
      preview: answer.preview,
      parentTestsUnknown: guard.unknown,
    },
  };
}

/** The run the worker named as holding the lock, with its start, if the ledger still has it. */
async function holderOf(
  exec: SqlExecutor,
  input: { tenantId: string },
  refused: { runId: string },
): Promise<BuildHolder | null> {
  if (refused.runId === "") {
    return null;
  }
  const run = await getRun(exec, input.tenantId, refused.runId);
  return run === null ? null : { runId: run.id, startedAt: run.startedAt };
}

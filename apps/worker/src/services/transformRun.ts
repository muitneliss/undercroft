/**
 * One transform as a run in the ledger: opened, given its turn, built, closed.
 *
 * Apart from `jobs.ts`, which starts runs and keeps track of them, because this is the one run
 * whose life has three parts worth reading on their own: the opening refuses before a row
 * exists, the turn (ADR 0088) keeps a person at the model editor from queueing behind a scheduled
 * build, and the settling writes what dbt did step by step. `done` settles with whether the build
 * succeeded and never rejects, because the failure is already in the ledger.
 */

import { describeError, newRunId } from "@undercroft/core";
import {
  closeRun,
  MAX_ERROR_CHARS,
  openRun,
  recordSteps,
  type RunTrigger,
  SOURCE_OF_TRANSFORM,
} from "@undercroft/db/repos";

import { RunInProgress } from "./ingest.ts";
import type { JobDeps } from "./jobs.ts";
import { createRunJournal, type RunJournal } from "./runJournal.ts";
import { turnsFor } from "./slots.ts";
import { runTransform, type TransformDeps, type TransformOutcome } from "./transform.ts";

export interface TransformOpening {
  readonly tenantId: string;
  readonly trigger: RunTrigger;
  readonly triggeredBy?: string;
  readonly parentRunId?: string | null;
  readonly select?: string;
  /** A build the editor is waiting on gets a shorter deadline than a scheduled one. */
  readonly timeoutMs?: number;
}

/**
 * How long an editor build waits for a turn before it gives up saying the worker is busy. Part
 * of its deadline (`BUILD_TIMEOUT_MS` in `jobs.ts`), not added to it: the control plane stops
 * waiting at 150 s.
 */
const EDITOR_WAIT_MS = 20_000;
/** However long the wait was, a build that got a turn is given at least this to run. */
const MIN_BUILD_MS = 30_000;

/**
 * Open a transform run and start the build, returning the id before dbt has spawned.
 *
 * `source` is `*`: a transform is per tenant, and the same partial index that keeps two
 * ingests of one source apart keeps two builds of one tenant apart. A non-zero dbt exit is
 * a failed run carrying the last lines of its output -- never the whole log, which can
 * echo row values from a failing test.
 *
 * What refuses, refuses before a row exists: no dbt in this deployment, or a build for
 * this tenant already running.
 */
export async function startTransform(
  deps: JobDeps,
  input: TransformOpening,
): Promise<{ runId: string; done: Promise<boolean> }> {
  const { dbt } = deps;
  if (dbt === undefined) {
    throw new Error("transform is not configured");
  }
  const runId = newRunId();
  const opened = await openRun(deps.exec, {
    id: runId,
    tenantId: input.tenantId,
    source: SOURCE_OF_TRANSFORM,
    verb: "transform",
    trigger: input.trigger,
    triggeredBy: input.triggeredBy ?? "",
    parentRunId: input.parentRunId ?? null,
    releaseTag: deps.releaseTag ?? "",
  });
  if (!opened.ok) {
    throw new RunInProgress("transform", input.tenantId, opened.runId);
  }
  const log = deps.log?.child({ runId, tenantId: input.tenantId, source: SOURCE_OF_TRANSFORM });
  const journal = createRunJournal({
    exec: deps.exec,
    runId,
    ...(log === undefined ? {} : { log }),
  });
  journal.info("run_opened", { verb: "transform", trigger: input.trigger });

  const done = buildInTurn(deps, dbt, input, journal).then(
    (outcome) => settleTransform(deps, runId, journal, outcome),
    async (error: unknown) => {
      await closeRun(deps.exec, runId, { status: "failed", error: messageOf(error) });
      journal.error("run_failed", describeError(error));
      await journal.flush();
      return false;
    },
  );
  return { runId, done };
}

/**
 * The build, once it has its turn (ADR 0088). A build the editor is waiting on has turns of its
 * own, so a person is never queued behind a scheduled build, and waits for one at most
 * EDITOR_WAIT_MS; its deadline is what is left of `timeoutMs` once it has a turn, so the whole
 * stays inside what the control plane waits for.
 */
function buildInTurn(
  deps: JobDeps,
  dbt: TransformDeps,
  input: TransformOpening,
  journal: RunJournal,
): Promise<TransformOutcome> {
  const editor = input.trigger === "build";
  const asked = Date.now();
  return turnsFor(deps.turns, editor ? "editorBuild" : "build").run(
    () => {
      const timeoutMs =
        input.timeoutMs === undefined
          ? undefined
          : Math.max(MIN_BUILD_MS, input.timeoutMs - (Date.now() - asked));
      return runTransform(dbt, {
        tenantId: input.tenantId,
        ...(input.select === undefined ? {} : { select: input.select }),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      });
    },
    {
      ...(deps.stop === undefined ? {} : { stop: deps.stop }),
      ...(editor ? { waitMs: EDITOR_WAIT_MS } : {}),
      onWait: (waiting) => journal.info("run_waiting", { waiting }),
    },
  );
}

/** Write what the build did -- its steps, its outcome, and what it says for itself. */
async function settleTransform(
  deps: JobDeps,
  runId: string,
  journal: RunJournal,
  outcome: TransformOutcome,
): Promise<boolean> {
  await recordSteps(deps.exec, runId, outcome.steps);
  await closeRun(deps.exec, runId, {
    status: outcome.ok ? "ok" : "failed",
    testsFailed: outcome.testsFailed,
    ...(outcome.error === null ? {} : { error: outcome.error.slice(0, MAX_ERROR_CHARS) }),
  });
  // A build with nothing to build is the commonest green run with nothing in it, and the
  // screen showed it as a success with five zeroes and no explanation at all.
  if (outcome.models === 0) {
    journal.warn("no_models");
  } else {
    journal.info("dbt_finished", {
      models: outcome.steps.filter((s) => s.kind === "model").length,
      tests: outcome.steps.filter((s) => s.kind === "test").length,
      testsFailed: outcome.testsFailed,
    });
  }
  journal.info("run_closed", {
    status: outcome.ok ? "ok" : "failed",
    steps: outcome.steps.length,
    testsFailed: outcome.testsFailed,
  });
  await journal.flush();
  return outcome.ok;
}

/**
 * The fault, as the ledger keeps it. A `ConnectorError` raised by `runTransform` carries
 * dbt's last lines in its cause; that tail is the useful part and the message alone says
 * only that it exited non-zero.
 */
function messageOf(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error).slice(0, MAX_ERROR_CHARS);
  }
  if (error.cause instanceof Error) {
    return `${error.message}: ${error.cause.message}`.slice(0, MAX_ERROR_CHARS);
  }
  return error.message.slice(0, MAX_ERROR_CHARS);
}

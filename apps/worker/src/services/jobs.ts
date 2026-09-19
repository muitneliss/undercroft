/**
 * Runs that outlive the request that started them.
 *
 * A full ingest is minutes, and an HTTP connection held open for minutes survives neither
 * a worker restart nor a scheduler restart and leaves no id behind. So the verb opens the
 * run, answers with its id, and the work continues here -- in this process, with no queue.
 * The accepted cost is that a restart kills what is in flight, which `closeAbandonedRuns`
 * records honestly at the next boot: the state lives in `ops.run`, not in this module.
 *
 * `drainJobs` exists for tests and for a graceful stop: it settles when every job started
 * through here has, and it never throws -- a job's failure is in the ledger and the log,
 * which is where a reader of "what happened" looks.
 */

import { type BuildModelResponse, MAX_PREVIEW_ROWS, type TableResult } from "@undercroft/contracts";
import { describeError, newRunId } from "@undercroft/core";
import {
  closeRun,
  getRun,
  MAX_ERROR_CHARS,
  openRun,
  recordSteps,
  type RunTrigger,
  SOURCE_OF_TRANSFORM,
  stepsFor,
  tenantRolesFor,
} from "@undercroft/db/repos";

import { RunInProgress, startIngest } from "./ingest.ts";
import type { RunDeps } from "./runTypes.ts";
import { readRelation } from "./preview.ts";
import { createRunJournal, type RunJournal } from "./runJournal.ts";
import { runTransform, type TransformDeps, type TransformOutcome } from "./transform.ts";

export interface JobDeps extends RunDeps {
  /** Absent means no transform is chained after an ingest: this deployment has no dbt. */
  readonly dbt?: TransformDeps;
}

const inFlight = new Set<Promise<unknown>>();

function track<T>(job: Promise<T>): void {
  const settled: Promise<unknown> = job.then(
    () => undefined,
    () => undefined,
  );
  inFlight.add(settled);
  void settled.finally(() => inFlight.delete(settled));
}

/** Settles once every job started so far has, however it ended. */
export async function drainJobs(): Promise<void> {
  while (inFlight.size > 0) {
    await Promise.all([...inFlight]);
  }
}

/**
 * Start an ingest and, when it succeeds, the tenant's transform after it.
 *
 * The transform is a run of its own with `parentRunId` pointing at the ingest, so the
 * ledger reads as two consecutive lines: what landed, then what was built from it. A failed
 * ingest chains nothing -- the previous tables keep serving, stale rather than wrong.
 */
export async function startIngestJob(
  deps: JobDeps,
  input: {
    source: string;
    tenantId: string;
    trigger: RunTrigger;
    triggeredBy: string;
    chain: boolean;
  },
): Promise<{ runId: string }> {
  const started = await startIngest(deps, input);
  const job = started.done.then(async () => {
    if (input.chain && deps.dbt !== undefined) {
      await runTransformRun(deps, {
        tenantId: input.tenantId,
        trigger: input.trigger,
        triggeredBy: input.triggeredBy,
        parentRunId: started.runId,
      });
    }
  });
  track(job);
  return { runId: started.runId };
}

interface TransformOpening {
  readonly tenantId: string;
  readonly trigger: RunTrigger;
  readonly triggeredBy?: string;
  readonly parentRunId?: string | null;
  readonly select?: string;
  /** A build the editor is waiting on gets a shorter deadline than a scheduled one. */
  readonly timeoutMs?: number;
}

/**
 * Open a transform run and start the build, returning the id before dbt has spawned.
 *
 * `source` is `*`: a transform is per tenant, and the same partial index that keeps two
 * ingests of one source apart keeps two builds of one tenant apart. A non-zero dbt exit is
 * a failed run carrying the last lines of its output -- never the whole log, which can
 * echo row values from a failing test. `done` settles with whether the build succeeded;
 * it never rejects, because the failure is already in the ledger.
 *
 * What refuses, refuses before a row exists: no dbt in this deployment, or a build for
 * this tenant already running.
 */
async function startTransform(
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

  const done = runTransform(dbt, {
    tenantId: input.tenantId,
    ...selectOf(input),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
  }).then(
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

function selectOf(input: TransformOpening): { select?: string } {
  if (input.select === undefined) {
    return {};
  }
  return { select: input.select };
}

/** Run the transform as a run in the ledger and wait for it: open, build, close. */
export async function runTransformRun(
  deps: JobDeps,
  input: TransformOpening,
): Promise<{ runId: string; ok: boolean }> {
  const started = await startTransform(deps, input);
  return { runId: started.runId, ok: await started.done };
}

/** Start a transform and return its id; the build continues in-process. */
export async function startTransformJob(
  deps: JobDeps,
  input: TransformOpening,
): Promise<{ runId: string }> {
  const started = await startTransform(deps, input);
  track(started.done);
  return { runId: started.runId };
}

/** How long a build the editor is waiting on may take. Two minutes is a long wait at a desk. */
export const BUILD_TIMEOUT_MS = 120_000;

/**
 * Build one model and look at it, synchronously: the editor is waiting.
 *
 * A run in the ledger like any other transform, with `trigger: build` and `--select` for
 * the one model, so it sits in the journal beside the scheduled builds. What comes back is
 * read from the ledger the run just wrote -- its steps, its error, its failing-test count --
 * plus the model's first rows as the tenant's BI login, which is what proves the relation is
 * there for a dashboard and not only for its author.
 */
export async function buildModel(
  deps: JobDeps,
  input: { tenantId: string; model: string; triggeredBy: string },
): Promise<BuildModelResponse> {
  const { dbt } = deps;
  if (dbt === undefined) {
    throw new Error("transform is not configured");
  }
  const started = await startTransform(deps, {
    tenantId: input.tenantId,
    trigger: "build",
    triggeredBy: input.triggeredBy,
    select: input.model,
    timeoutMs: BUILD_TIMEOUT_MS,
  });
  const ok = await started.done;
  const [run, steps] = await Promise.all([
    getRun(deps.exec, input.tenantId, started.runId),
    stepsFor(deps.exec, started.runId),
  ]);
  const roles = await tenantRolesFor(deps.exec, input.tenantId);
  const preview =
    ok && roles !== null
      ? await readRelation(dbt.sessions, {
          tenantId: input.tenantId,
          kind: "bi",
          schema: roles.analyticsSchema,
          relation: input.model,
          limit: MAX_PREVIEW_ROWS,
        })
      : null;
  return {
    runId: started.runId,
    ok,
    testsFailed: run?.testsFailed ?? 0,
    error: run?.error ?? null,
    steps,
    preview,
  };
}

export type DqOutcome =
  | { readonly ok: true; readonly value: TableResult }
  | { readonly ok: false; readonly reason: "run-not-found" | "step-not-found" | "not-dq" };

/** `"undercroft"."dq_case_0042"."not_null_stg_deals_deal_id"` -> its schema and name. */
const RELATION = /^"(?<database>[^"]+)"\."(?<schema>[^"]+)"\."(?<relation>[^"]+)"$/u;

/**
 * The rows a failed test stored, read as the tenant's dbt login (which owns the dq schema).
 *
 * The step names the relation dbt wrote; this refuses to read anything outside the
 * tenant's own dq schema, so a step whose relation was tampered into naming another schema
 * is `not-dq` rather than a read. The BI login has no USAGE on dq by design; an admin sees
 * these rows here and nowhere a dashboard could.
 */
export async function dqFailures(
  deps: JobDeps,
  input: { tenantId: string; runId: string; uniqueId: string; limit: number },
): Promise<DqOutcome> {
  const { dbt } = deps;
  if (dbt === undefined) {
    throw new Error("transform is not configured");
  }
  const run = await getRun(deps.exec, input.tenantId, input.runId);
  if (run === null) {
    return { ok: false, reason: "run-not-found" };
  }
  const step = (await stepsFor(deps.exec, input.runId)).find((s) => s.uniqueId === input.uniqueId);
  if (step === undefined || step.kind !== "test") {
    return { ok: false, reason: "step-not-found" };
  }
  const roles = await tenantRolesFor(deps.exec, input.tenantId);
  const match = step.relation === null ? null : RELATION.exec(step.relation);
  const schema = match?.groups?.schema;
  const relation = match?.groups?.relation;
  if (
    roles === null ||
    schema === undefined ||
    relation === undefined ||
    schema !== roles.dqSchema
  ) {
    return { ok: false, reason: "not-dq" };
  }
  const value = await readRelation(dbt.sessions, {
    tenantId: input.tenantId,
    kind: "dbt",
    schema,
    relation,
    limit: input.limit,
  });
  return { ok: true, value };
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

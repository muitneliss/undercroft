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

// biome-ignore-all lint/complexity/noVoid: `void` here marks a promise deliberately not awaited, at the two places where that is correct and where dropping the marker would make it look like an oversight.
// biome-ignore-all lint/performance/noAwaitInLoops: These sequential awaits are the point. Pacing a connector against a rate limit, walking Dokploy deployment records until one settles, and migrating SQL files in order all require the previous iteration to finish first; running them concurrently is the bug this rule would introduce.
// biome-ignore-all lint/style/useExportsLast: Reordering 28 modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. The ordering carries meaning here and the rule's preferred one does not.

import { describeError, newRunId } from "@undercroft/core";
import {
  closeRun,
  openRun,
  type RunTrigger,
  SOURCE_OF_TRANSFORM,
  MAX_ERROR_CHARS,
} from "@undercroft/db/repos";

import { type RunDeps, RunInProgress, startIngest } from "./ingest.ts";
import { runTransform, type TransformDeps } from "./transform.ts";

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
  log?.info("run_opened", { verb: "transform", trigger: input.trigger });

  const done = runTransform(dbt, selectOf(input)).then(
    async () => {
      await closeRun(deps.exec, runId, { status: "ok" });
      log?.info("run_closed", { status: "ok" });
      return true;
    },
    async (error: unknown) => {
      await closeRun(deps.exec, runId, { status: "failed", error: messageOf(error) });
      log?.error("run_failed", describeError(error));
      return false;
    },
  );
  return { runId, done };
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

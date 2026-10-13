/**
 * Runs that outlive the request that started them.
 *
 * A full ingest is minutes, and an HTTP connection held open for minutes survives neither
 * a worker restart nor a scheduler restart and leaves no id behind. So the verb opens the
 * run, answers with its id, and the work continues here, in this process -- once it has a turn:
 * each kind of run is bounded to so many at once and the rest wait, already in the ledger
 * (`slots.ts`, ADR 0088). The state lives in `ops.run`, not in this module.
 *
 * The accepted cost is that a restart ENDS what is in flight; ADR 0051 is what keeps it from
 * also erasing it. A stop the process is told about (a deploy's SIGTERM) aborts `RunDeps.stop`,
 * an ingest stops at its next safe boundary and settles with what it landed, and `server.ts`
 * waits for that, through `drainJobs`, for a bounded time (`shutdown.ts`). What is still running
 * when the bound runs out -- a transform mid-build, a long listing -- is closed then, by this
 * process, as cut off by the shutdown (ADR 0056). Only what a kill takes without warning is left
 * to `closeAbandonedRuns` at the next boot. Both say that their zero counts are not a count.
 *
 * `drainJobs` settles when every job started through here has, and it never throws -- a job's
 * failure is in the ledger and the log, which is where a reader of "what happened" looks.
 */

import {
  type BuildModelResponse,
  MAX_PREVIEW_ROWS,
  selectedModel,
  type TableResult,
} from "@undercroft/contracts";
import { getRun, type RunTrigger, stepsFor, tenantRolesFor } from "@undercroft/db/repos";

import { RunInProgress, startIngest } from "./ingest.ts";
import type { RunDeps } from "./runTypes.ts";
import { countRelations, readRelation } from "./preview.ts";
import type { Spawn, TransformDeps } from "./transform.ts";
import { startTransform, type TransformOpening } from "./transformRun.ts";
import type { SemanticAsk } from "./semantic/definition.ts";

export interface JobDeps extends RunDeps {
  /** Absent means no transform is chained after an ingest: this deployment has no dbt. */
  readonly dbt?: TransformDeps;
  /**
   * How a document's bytes are handed to a reader. Injected in tests; the process passes one
   * that runs poppler and tesseract out of the worker image. Absent means the extract verb
   * is not configured in this deployment, exactly as an absent `dbt` disables transform.
   */
  readonly extractSpawn?: Spawn;
  /** The document-kind classifier. Absent means the semantic verbs are not configured. */
  readonly semanticAsk?: SemanticAsk;
}

const inFlight = new Set<Promise<unknown>>();

export function track<T>(job: Promise<T>): void {
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
    // A worker that is stopping opens no new build: it would only wait for a turn and be
    // closed as stopped, one more failed line in the ledger per ingest that settled in time.
    if (!input.chain || deps.dbt === undefined || deps.stop?.aborted === true) {
      return;
    }
    try {
      await runTransformRun(deps, {
        tenantId: input.tenantId,
        trigger: input.trigger,
        triggeredBy: input.triggeredBy,
        parentRunId: started.runId,
      });
    } catch (error) {
      if (!(error instanceof RunInProgress)) {
        throw error;
      }
      // The tenant's build is already running or waiting, and it will read what this ingest
      // landed; said here, because it used to vanish without a line anywhere.
      deps.log?.info("transform_not_chained", {
        runId: started.runId,
        tenantId: input.tenantId,
        runningRunId: error.runId,
      });
    }
  });
  track(job);
  return { runId: started.runId };
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
 * How long every row count of one build may take together. Inside the control plane's wait
 * (150 s) beside the build's own two minutes, with room for the steps and the preview.
 */
const ROW_COUNT_BUDGET_MS = 10_000;

/** What a build is asked: some models, as dbt selectors, for someone. */
export interface BuildInput {
  readonly tenantId: string;
  /** `ModelSelector`s -- `name`, `+name`, `name+` -- built as one union. */
  readonly select: readonly string[];
  readonly triggeredBy: string;
}

/**
 * Open the build's run and start it: a transform with `trigger: build` and `--select` for the
 * selection, so it sits in the journal beside the scheduled builds, takes an editor's turn and
 * the editor's deadline, and is refused, before any row exists, while the tenant's build lock is
 * held. One function for the build that is waited on and the one that is not, so the two can
 * never differ in anything but who waits.
 */
function startBuild(
  deps: JobDeps,
  input: BuildInput,
): Promise<{ runId: string; done: Promise<boolean> }> {
  return startTransform(deps, {
    tenantId: input.tenantId,
    trigger: "build",
    triggeredBy: input.triggeredBy,
    select: input.select,
    timeoutMs: BUILD_TIMEOUT_MS,
  });
}

/**
 * Start a build and answer with its run, leaving it to finish in-process (issue 442): for a
 * caller that would rather wait on the run than hold a request open for the whole build.
 */
export async function startBuildJob(deps: JobDeps, input: BuildInput): Promise<{ runId: string }> {
  const started = await startBuild(deps, input);
  track(started.done);
  return { runId: started.runId };
}

/**
 * Build some models and look at them, synchronously: the editor is waiting.
 *
 * What comes back is read from the ledger the run just wrote -- its steps, its error, its
 * failing-test count -- plus, as the tenant's BI login, how many rows each NAMED model now
 * holds and the first rows of the one named model, which is what proves the relation is there
 * for a dashboard and not only for its author. A model this run did not PUBLISH is neither
 * counted nor previewed (ADR 0131): the table a dashboard reads is an earlier build's, and
 * counting it would date an old figure to now; the rows it built and held back are in staging,
 * which no dashboard reads, and what its tests refused is in the failing rows (`dqFailures`).
 * Its step says `promoted: false`, which is how a reader tells "held" from "not counted".
 */
export async function buildModels(deps: JobDeps, input: BuildInput): Promise<BuildModelResponse> {
  const { dbt } = deps;
  if (dbt === undefined) {
    throw new Error("transform is not configured");
  }
  const started = await startBuild(deps, input);
  const ok = await started.done;
  const [run, steps, roles] = await Promise.all([
    getRun(deps.exec, input.tenantId, started.runId),
    stepsFor(deps.exec, started.runId),
    tenantRolesFor(deps.exec, input.tenantId),
  ]);
  const named = [...new Set(input.select.map(selectedModel))];
  const built = new Set(
    steps.filter((s) => s.kind === "model" && s.promoted === true).map((s) => s.name),
  );
  const countable = named.filter((name) => built.has(name));
  const counts =
    roles === null
      ? new Map<string, number | null>()
      : await countRelations(
          dbt.sessions,
          {
            tenantId: input.tenantId,
            kind: "bi",
            schema: roles.analyticsSchema,
            relations: countable,
            budgetMs: ROW_COUNT_BUDGET_MS,
          },
          deps.log,
        );
  const [only] = named;
  const preview =
    named.length === 1 && only !== undefined && built.has(only) && roles !== null
      ? await readRelation(dbt.sessions, {
          tenantId: input.tenantId,
          kind: "bi",
          schema: roles.analyticsSchema,
          relation: only,
          limit: MAX_PREVIEW_ROWS,
        })
      : null;
  return {
    runId: started.runId,
    ok,
    testsFailed: run?.testsFailed ?? 0,
    error: run?.error ?? null,
    steps,
    rowCounts: named.map((name) => ({ name, rows: counts.get(name) ?? null })),
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

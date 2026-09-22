/**
 * The ledger as the interface reads it: a page of runs, and one run in full.
 *
 * Values in, values out. `get` answers `null` for a run that is not this tenant's, and the
 * handler decides that is NOT_FOUND -- the same shape as every other decision in this layer.
 *
 * `kind` is derived here rather than stored: `build` is a transform run the editor started,
 * `lake-api` an ingest run an external script landed, and both share the row shape and the
 * one-running-per-pair guard with the scheduled kinds. A stored column would be a second
 * copy of `verb` + `trigger` to keep in step.
 */

import type { SqlExecutor } from "@undercroft/db";
import {
  entitiesForRuns,
  eventsFor,
  findChildRun,
  getRun,
  listRuns,
  refusalsFor,
  type Run,
  type RunEntity,
  type RunEvent,
  type RunRefusal,
  type RunStep,
  SOURCE_OF_TRANSFORM,
  stepsFor,
} from "@undercroft/db/repos";
import { record as recordAudit } from "../repos/auditLog.ts";
import type { TriggerOutcome, WorkerClient } from "./workerClient.ts";

export type RunKind = "ingest" | "transform" | "build" | "lake-api";

export interface RunView {
  readonly id: string;
  readonly kind: RunKind;
  /** The source for an ingest; `null` for a transform, which is per tenant. */
  readonly source: string | null;
  readonly entities: string[];
  readonly status: Run["status"];
  readonly trigger: Run["trigger"];
  readonly startedAt: string;
  readonly endedAt: string | null;
  /** Null when there is no count to give -- see {@link countsOf} for the two reasons. */
  readonly counts: {
    landed: number;
    created: number;
    changed: number;
    unchanged: number;
    refused: number;
  } | null;
  readonly testsFailed: number | null;
  readonly error: string | null;
  readonly parentRunId: string | null;
}

/**
 * A doorway to a run on the other side of a chain, not that run in full: enough to name it,
 * show its own outcome, and link to it. `RunDetail.get` resolves both directions off
 * `parentRunId` -- which has named a run's parent since `090_runs.sql` -- so a leaf open on
 * either end of an ingest-then-build chain can point across it without a second round trip.
 */
export interface RunLink {
  readonly id: string;
  readonly kind: RunKind;
  readonly source: string | null;
  readonly status: Run["status"];
  readonly testsFailed: number | null;
}

export interface RunDetail extends RunView {
  readonly entityCounts: RunEntity[];
  readonly refusals: (RunRefusal & { at: string })[];
  readonly steps: RunStep[];
  /** The run this one was chained from, if `parentRunId` names one that still exists. */
  readonly parentRun: RunLink | null;
  /** The run this one chained into, once it exists -- `null` before or without one. */
  readonly childRun: RunLink | null;
}

function kindOf(run: Run): RunKind {
  if (run.verb === "transform") {
    return run.trigger === "build" ? "build" : "transform";
  }
  return run.trigger === "lake-api" ? "lake-api" : "ingest";
}

function toLink(run: Run): RunLink {
  return {
    id: run.id,
    kind: kindOf(run),
    source: run.source === SOURCE_OF_TRANSFORM ? null : run.source,
    status: run.status,
    testsFailed: run.testsFailed,
  };
}

/**
 * What the run counted, or `null` when it counted nothing it could report.
 *
 * Two reasons, one answer, and in both of them the answer is "there is no number here"
 * rather than zero. A run still going has counts that are still changing, and a count still
 * changing is not a count. A transform has none at all: it builds tables out of what an
 * ingest already landed, and lands no record of its own, so the four zeroes its row used to
 * print said "it read nothing" about a run that was never going to read anything -- a
 * sentence a reader spends a minute disproving. The column that IS a transform's own figure,
 * `testsFailed`, is beside this and unaffected.
 */
function countsOf(run: Run, landed: number): RunView["counts"] {
  if (run.status === "running" || run.verb === "transform") {
    return null;
  }
  return {
    landed,
    created: run.created,
    changed: run.changed,
    unchanged: run.unchanged,
    refused: run.refused,
  };
}

function present(run: Run, entities: RunEntity[]): RunView {
  const landed = entities.reduce((sum, e) => sum + e.landed, 0);
  return {
    id: run.id,
    kind: kindOf(run),
    source: run.source === SOURCE_OF_TRANSFORM ? null : run.source,
    entities: entities.map((e) => e.entity),
    status: run.status,
    trigger: run.trigger,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    counts: countsOf(run, landed),
    testsFailed: run.testsFailed,
    error: run.error,
    parentRunId: run.parentRunId,
  };
}

export async function list(
  exec: SqlExecutor,
  tenantId: string,
  page: { limit: number; cursor?: string | null },
): Promise<{ items: RunView[]; nextCursor: string | null }> {
  const { items, nextCursor } = await listRuns(exec, tenantId, page);
  const entities = await entitiesForRuns(
    exec,
    items.map((r) => r.id),
  );
  return { items: items.map((run) => present(run, entities.get(run.id) ?? [])), nextCursor };
}

/**
 * Start an ingest for one source, on an admin's word.
 *
 * The worker opens the run and answers with its id; this records who asked. The audit row
 * names the source and the run, and the actor's address -- `ops.audit_log` is the one table
 * where an address is what a trail is for. An outcome other than `ok` is returned for the
 * handler to word; nothing is audited for a run that did not start.
 */
export async function trigger(
  exec: SqlExecutor,
  worker: WorkerClient,
  input: { tenantId: string; source: string; actor: string; actorId: string },
): Promise<TriggerOutcome> {
  const outcome = await worker.triggerIngest({
    source: input.source,
    tenantId: input.tenantId,
    triggeredBy: input.actorId,
  });
  if (outcome.ok) {
    await recordAudit(exec, {
      tenantId: input.tenantId,
      actor: input.actor,
      action: "runs.trigger",
      detail: JSON.stringify({ source: input.source, runId: outcome.runId }),
    });
  }
  return outcome;
}

export async function get(
  exec: SqlExecutor,
  tenantId: string,
  runId: string,
): Promise<RunDetail | null> {
  const run = await getRun(exec, tenantId, runId);
  if (run === null) {
    return null;
  }
  const entities = (await entitiesForRuns(exec, [run.id])).get(run.id) ?? [];
  const [refusals, steps, childRun, parentRun] = await Promise.all([
    refusalsFor(exec, run.id),
    stepsFor(exec, run.id),
    findChildRun(exec, tenantId, run.id),
    run.parentRunId === null ? Promise.resolve(null) : getRun(exec, tenantId, run.parentRunId),
  ]);
  return {
    ...present(run, entities),
    entityCounts: entities,
    refusals,
    steps,
    parentRun: parentRun === null ? null : toLink(parentRun),
    childRun: childRun === null ? null : toLink(childRun),
  };
}

/**
 * What a run has been saying about itself, for somebody watching it happen.
 *
 * Read on its own rather than folded into `get`, because the two change at different rates:
 * a detail is worth re-reading when a run ends, a feed every couple of seconds while it
 * runs, and one call carrying both would re-send every refusal and every dbt step on each
 * tick.
 *
 * `null` for a run that is not this tenant's, decided through `getRun` rather than by
 * reading the events and finding none -- an id that returns an empty feed for a stranger's
 * run and an empty feed for a run of one's own that has said nothing yet must be the same
 * answer, and the run's ownership is the thing that must not leak.
 */
export async function events(
  exec: SqlExecutor,
  tenantId: string,
  runId: string,
): Promise<RunEvent[] | null> {
  const run = await getRun(exec, tenantId, runId);
  if (run === null) {
    return null;
  }
  return eventsFor(exec, run.id);
}

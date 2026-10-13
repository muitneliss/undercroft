/**
 * The ledger as the interface reads it: a page of runs, and one run in full.
 *
 * Values in, values out. `get` answers `null` for a run that is not this tenant's, and the
 * handler decides that is NOT_FOUND -- the same shape as every other decision in this layer.
 *
 * `kind` is the repo's, derived in SQL from `verb` + `trigger` (see `RunKind` in the runs repo),
 * because the ledger is filtered by it as well as read by it.
 *
 * `get` can wait for a run to settle first (`runWait.ts`), and reports its dbt steps as a summary
 * and the page asked for (`stepReport.ts`).
 */

import { needsScope } from "@undercroft/contracts";
import { type RunVerdict, runVerdict } from "@undercroft/contracts/runs";
import type { SqlExecutor } from "@undercroft/db";
import {
  entitiesForRuns,
  eventsFor,
  findChildRun,
  getRun,
  listRuns,
  reasonsFor,
  type RecordedScope,
  recordedScope,
  refusalsFor,
  RUN_KINDS,
  RUN_STATUSES,
  RUN_TRIGGERS,
  type Run,
  type RunEntity,
  type RunEvent,
  type RunFilter,
  type RunKind,
  type RunReasonCount,
  type RunRefusal,
  SOURCE_OF_TRANSFORM,
  stepsFor,
} from "@undercroft/db/repos";
import { type Actor, record as recordAudit } from "../repos/auditLog.ts";
import { type ConnectionConfig, configOf } from "./connections.ts";
import { type RunWait, settled } from "./runWait.ts";
import { reportSteps, type StepQuery, type StepReport } from "./stepReport.ts";
import type { TriggerOutcome, WorkerClient } from "./workerClient.ts";

export type { RunFilter, RunKind } from "@undercroft/db/repos";

/** The values each of `runs.list`'s enumerated filters takes: the ledger's own vocabulary. */
export const RUN_FILTERS = { kind: RUN_KINDS, status: RUN_STATUSES, trigger: RUN_TRIGGERS };

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
  /**
   * What the run came to: `clean`, `tests-failing`, `failed` or `running`, derived from `status`
   * and `testsFailed` (ADR 0129). A build whose tests fail is `ok` and `tests-failing`: its
   * tables were written and are served, and this is the word that says they are suspect.
   */
  readonly verdict: RunVerdict;
  readonly error: string | null;
  readonly parentRunId: string | null;
  /** Which build produced this run; `""` when the image did not say. */
  readonly releaseTag: string;
  /** How much work was waiting when it drew its batch; `null` for a verb with no queue. */
  readonly pendingBefore: number | null;
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
  readonly verdict: RunVerdict;
}

/**
 * One run in full. Its dbt steps are a {@link StepReport}: a summary of every step, then the
 * page of them the caller asked for (`stepReport.ts`).
 */
export interface RunDetail extends RunView, StepReport {
  readonly entityCounts: RunEntity[];
  readonly refusals: (RunRefusal & { at: string })[];
  /**
   * What this run refused, counted by reason. The half that outlives the 7-day prune, so it
   * answers "what were the 245" for a run whose per-record rows are long gone.
   */
  readonly reasonCounts: RunReasonCount[];
  /**
   * The rollup remembers refusals whose individual rows have been pruned.
   *
   * Decided here rather than left to the interface, because "no rows" has two meanings that
   * must not render alike: a run that refused nothing, and a run whose detail aged out. The
   * second showing an empty table is the exact defect this whole feature exists to fix --
   * a count with nothing behind it -- so the difference is computed once, named, and sent.
   */
  readonly refusalsPruned: boolean;
  /** The run this one was chained from, if `parentRunId` names one that still exists. */
  readonly parentRun: RunLink | null;
  /** The run this one chained into, once it exists -- `null` before or without one. */
  readonly childRun: RunLink | null;
  /**
   * The scope this run read with, in the shape the card summarises a connection's scope in --
   * or `null` when there is none to name. ADR 0091.
   *
   * Recorded by the run itself as it read (`app.run_scope`), so a save since does not change
   * it. `null` for every run that recorded none -- a run from before the recording existed, a
   * lake-API batch, a transform -- and never filled in from the connection's scope today, which
   * would date today's answer to the past (ADR 0039). `{}` is a scope too: a HubSpot connection
   * nobody had scoped, which read the spec's own properties.
   */
  readonly scope: ConnectionConfig | null;
}

/**
 * What a run recorded as its scope, as the card would summarise it, or `null` for nothing to
 * name.
 *
 * A source that must be scoped and recorded nothing usable is `null` rather than `{}`: the card's
 * summary reads `{}` for Gmail as "the whole mailbox", and a run that had no usable scope read
 * nothing at all (the collector refuses it). Naming the widest reading for it would be the guess
 * `parseScope` exists to refuse.
 */
function scopeOf(source: string, recorded: RecordedScope | null): RunDetail["scope"] {
  if (recorded === null) {
    return null;
  }
  const selectionJson = recorded.selectionJson ?? "{}";
  return needsScope(source, selectionJson) ? null : configOf(source, selectionJson);
}

function toLink(run: Run): RunLink {
  return {
    id: run.id,
    kind: run.kind,
    source: run.source === SOURCE_OF_TRANSFORM ? null : run.source,
    status: run.status,
    testsFailed: run.testsFailed,
    verdict: runVerdict(run.status, run.testsFailed),
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
    kind: run.kind,
    source: run.source === SOURCE_OF_TRANSFORM ? null : run.source,
    entities: entities.map((e) => e.entity),
    status: run.status,
    trigger: run.trigger,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    counts: countsOf(run, landed),
    testsFailed: run.testsFailed,
    verdict: runVerdict(run.status, run.testsFailed),
    error: run.error,
    parentRunId: run.parentRunId,
    releaseTag: run.releaseTag,
    pendingBefore: run.pendingBefore,
  };
}

/**
 * A page of the ledger, narrowed by any of `RunFilter`'s fields: one account's runs (ADR 0043),
 * as the journal opened from that account's card asks for them, or the failed builds since ten
 * o'clock, as an agent asks for them instead of listing everything and filtering it itself.
 */
export async function list(
  exec: SqlExecutor,
  tenantId: string,
  page: { limit: number; cursor?: string | null } & RunFilter,
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
  input: { tenantId: string; source: string; actor: Actor; actorId: string },
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

/** What `get` is asked: which steps to list, and whether to wait for the run to settle first. */
export interface RunRead {
  readonly steps: StepQuery;
  readonly wait?: RunWait | undefined;
}

/**
 * One run in full, or `null` for a run that is not this tenant's.
 *
 * With `wait`, it is answered once the run has settled (see `settled`), or when the wait runs out
 * -- and then the answer is exactly what an immediate read would have said: `running`, with no
 * counts and the verdict `running`. Its dbt steps are reported by `reportSteps`, so the summary always comes
 * and the steps come as `read.steps` asks.
 */
export async function get(
  exec: SqlExecutor,
  tenantId: string,
  runId: string,
  read: RunRead,
): Promise<RunDetail | null> {
  const run =
    read.wait === undefined
      ? await getRun(exec, tenantId, runId)
      : await settled(exec, tenantId, runId, read.wait);
  if (run === null) {
    return null;
  }
  const entities = (await entitiesForRuns(exec, [run.id])).get(run.id) ?? [];
  const [refusals, reasonCounts, steps, childRun, parentRun, recorded] = await Promise.all([
    refusalsFor(exec, run.id),
    reasonsFor(exec, run.id),
    stepsFor(exec, run.id),
    findChildRun(exec, tenantId, run.id),
    run.parentRunId === null ? Promise.resolve(null) : getRun(exec, tenantId, run.parentRunId),
    recordedScope(exec, run.id),
  ]);
  return {
    ...present(run, entities),
    ...reportSteps(steps, read.steps),
    entityCounts: entities,
    refusals,
    reasonCounts,
    // The rollup remembers what the per-record rows no longer hold. Not `run.refused > 0`:
    // a run from before the rollup existed has neither, and claiming its detail was pruned
    // would be inventing a history for it.
    refusalsPruned: reasonCounts.length > 0 && refusals.length === 0,
    parentRun: parentRun === null ? null : toLink(parentRun),
    childRun: childRun === null ? null : toLink(childRun),
    scope: scopeOf(run.source, recorded),
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

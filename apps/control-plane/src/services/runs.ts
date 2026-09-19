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

// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useExportsLast: Reordering modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. That ordering carries meaning; the rule's preferred one does not.

import type { SqlExecutor } from "@undercroft/db";
import {
  entitiesForRuns,
  getRun,
  listRuns,
  refusalsFor,
  type Run,
  type RunEntity,
  type RunRefusal,
  type RunStep,
  SOURCE_OF_TRANSFORM,
  stepsFor,
} from "@undercroft/db/repos";

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
  /** Null while running: a count that is still changing is not a count. */
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

export interface RunDetail extends RunView {
  readonly entityCounts: RunEntity[];
  readonly refusals: (RunRefusal & { at: string })[];
  readonly steps: RunStep[];
}

function kindOf(run: Run): RunKind {
  if (run.verb === "transform") {
    return run.trigger === "build" ? "build" : "transform";
  }
  return run.trigger === "lake-api" ? "lake-api" : "ingest";
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
    counts:
      run.status === "running"
        ? null
        : {
            landed,
            created: run.created,
            changed: run.changed,
            unchanged: run.unchanged,
            refused: run.refused,
          },
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
  const [refusals, steps] = await Promise.all([refusalsFor(exec, run.id), stepsFor(exec, run.id)]);
  return { ...present(run, entities), entityCounts: entities, refusals, steps };
}

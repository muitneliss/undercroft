/**
 * Compact the raw lake: remove the observations that repeat the one kept before them, where a
 * spec has declared which arrays are sets. ADR 0160.
 *
 * HubSpot's v4 association reads shuffled their sets, and until ADR 0158 every shuffle landed as
 * a new version -- thirty-odd per link record, A, B, A, B. ADR 0158 stopped it going forward and
 * left the history to "a separate, explicit compaction step that must use `canonicalPayload`".
 * This is that step. It removes only what ADR 0158 would have reported `unchanged` had it been
 * in force: two payloads are the same record exactly when `canonicalPayload` over the entity's
 * own `unorderedArrays` says so, so an entity that declares nothing is never considered.
 *
 * It composes three things that must not know about each other -- the spec (which arrays are
 * sets), the loader's cursor and the runs in progress (what it is safe to touch), and the lake
 * (the one writer, which does the deleting). The decisions this file makes are the two safety
 * rules, and both are about the loader:
 *
 * - **Nothing past `raw.load_cursor`.** An observation the loader has not projected is one
 *   `raw.records` may not yet hold; the lake considers only stamps at or before the cursor, and a
 *   stream with no cursor not at all.
 * - **Not while a run of that (tenant, source) is in progress.** Two loader passes over one
 *   stream overlap by design (`repos/rawRecords.ts`, `writeCursor`), and a slower one is still
 *   reading a journal listing taken before the cursor moved. Removing a pointer under it would
 *   fail that run. The cursor is read FIRST and the runs second, so any pass that is not refused
 *   here started from a cursor at least as far on, and reads nothing this removes.
 *
 * **Reported before it deletes.** Each stream's plan -- every (key, stamp) it will remove -- is
 * written to the lake first, then applied, then what was actually removed is written beside it.
 * A run cut off half way has still named what it set out to remove; running it again removes the
 * rest and names that too. A dry run is the plan alone.
 */

import { canonicalPayload } from "@undercroft/connector-runtime";
import { streamOf } from "@undercroft/contracts";
import { type Logger, parseLossless } from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";
import { anyRunRunning } from "@undercroft/db/repos";
import type { Canonicaliser, CompactionPlan, LakeStore } from "@undercroft/lake";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { type LoadedStream, loadedStreams } from "../repos/rawRecords.ts";
import { readSpec } from "./specs.ts";

/** How many keys are planned or applied at once: round trips in flight, not CPU. */
export const DEFAULT_CONCURRENCY = 16;

/** The kind under `_reports/` a compaction's plans and results are written as. */
export const REPORT_KIND = "lake-compaction";

export interface CompactionDeps {
  readonly exec: SqlExecutor;
  readonly lake: LakeStore;
  readonly specsDir: string;
  readonly log?: Logger;
  readonly concurrency?: number;
}

export interface CompactionRequest {
  /** `false` plans and reports, deleting nothing. */
  readonly apply: boolean;
  /** One tenant's streams, or every tenant's when `null`. */
  readonly tenantId: string | null;
}

/** What happened to one stream. */
export interface StreamCompaction {
  readonly stream: string;
  /** The loader's cursor: nothing stamped after it was considered. */
  readonly through: string;
  /** Why nothing was considered, or `null` when the stream was planned. */
  readonly skipped: "run-in-progress" | null;
  readonly keys: number;
  readonly examined: number;
  /** Observations removed -- or, in a dry run, that would be. */
  readonly removed: number;
  /** Keys whose observations moved between plan and apply, left for the next run. */
  readonly changed: number;
  /** Where the plan and the result were written, `null` where none was. */
  readonly planReport: string | null;
  readonly doneReport: string | null;
}

export interface CompactionOutcome {
  readonly apply: boolean;
  readonly streams: readonly StreamCompaction[];
}

const decoder = new TextDecoder();

/** The spec's own word for which arrays are sets, as the equivalence the lake compares by. */
function canonicaliserFor(paths: readonly string[]): Canonicaliser {
  return (bytes) => {
    try {
      return canonicalPayload(parseLossless(decoder.decode(bytes)), paths);
    } catch {
      // Bytes that do not parse cannot be shown to equal anything, so they are kept.
      return null;
    }
  };
}

/** Each entity of `source` that declares unordered arrays, with them. Empty with no spec. */
function declaredSets(specsDir: string, source: string): Map<string, readonly string[]> {
  const declared = new Map<string, readonly string[]>();
  if (!existsSync(join(specsDir, `${source}.yaml`))) {
    return declared;
  }
  for (const entity of readSpec(specsDir, source).entities) {
    if (entity.unorderedArrays !== undefined) {
      declared.set(entity.name, entity.unorderedArrays);
    }
  }
  return declared;
}

/**
 * `work` over `items`, at most `limit` at a time, results in input order. Exported for the other
 * operator command that walks the lake over a tunnel (`documentBytesPurge.ts`).
 */
export async function inTurns<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  // One iterator shared by every lane: each `next()` hands the next item to whichever lane asks.
  const queue = items.entries();
  async function lane(): Promise<void> {
    for (const [index, item] of queue) {
      results[index] = await work(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

/** The (key, stamps) pairs of the plans that remove anything: what a report names. */
function namedIn(plans: readonly CompactionPlan[]): { sourceKey: string; stamps: string[] }[] {
  return plans
    .filter((plan) => plan.remove.length > 0)
    .map((plan) => ({ sourceKey: plan.sourceKey, stamps: plan.remove.map((r) => r.stamp) }));
}

function countRemoved(plans: readonly CompactionPlan[]): number {
  return plans.reduce((sum, plan) => sum + plan.remove.length, 0);
}

async function compactStream(
  deps: CompactionDeps,
  request: CompactionRequest,
  loaded: LoadedStream,
  paths: readonly string[],
): Promise<StreamCompaction> {
  const stream = streamOf(loaded);
  const through = loaded.lastStamp;
  const none = { stream, through, keys: 0, examined: 0, removed: 0, changed: 0 };
  if (await anyRunRunning(deps.exec, loaded)) {
    return { ...none, skipped: "run-in-progress", planReport: null, doneReport: null };
  }
  const limit = deps.concurrency ?? DEFAULT_CONCURRENCY;
  const canonical = canonicaliserFor(paths);
  const keys = await deps.lake.recordKeys(stream);
  const plans = await inTurns(keys, limit, (key) =>
    deps.lake.planCompaction(stream, key, canonical, through),
  );
  const counts = {
    keys: keys.length,
    examined: plans.reduce((sum, plan) => sum + plan.examined.length, 0),
    removed: countRemoved(plans),
  };
  const planReport = await deps.lake.report(REPORT_KIND, {
    phase: "plan",
    apply: request.apply,
    stream,
    through,
    ...counts,
    remove: namedIn(plans),
  });
  if (!request.apply) {
    return { ...none, ...counts, skipped: null, planReport, doneReport: null };
  }
  const due = plans.filter((plan) => plan.remove.length > 0);
  const applied = await inTurns(due, limit, (plan) => deps.lake.applyCompaction(plan));
  const done = due.filter((_, i) => applied[i] === true);
  const changed = due.filter((_, i) => applied[i] !== true).map((plan) => plan.sourceKey);
  const doneReport = await deps.lake.report(REPORT_KIND, {
    phase: "done",
    plan: planReport,
    stream,
    through,
    removed: countRemoved(done),
    changed,
    remove: namedIn(done),
  });
  return {
    ...none,
    keys: keys.length,
    examined: counts.examined,
    removed: countRemoved(done),
    changed: changed.length,
    skipped: null,
    planReport,
    doneReport,
  };
}

/**
 * Plan, and with `apply` carry out, the compaction of every loaded stream whose entity declares
 * unordered arrays. One stream at a time, its keys `concurrency` at a time.
 *
 * Idempotent: a second run plans what the first did not remove, and nothing else, because a
 * removed observation equalled the one kept before it and so never decided another's fate.
 */
export async function compactLake(
  deps: CompactionDeps,
  request: CompactionRequest,
): Promise<CompactionOutcome> {
  const specs = new Map<string, Map<string, readonly string[]>>();
  const streams: StreamCompaction[] = [];
  for (const loaded of await loadedStreams(deps.exec, request.tenantId)) {
    if (!specs.has(loaded.source)) {
      specs.set(loaded.source, declaredSets(deps.specsDir, loaded.source));
    }
    const paths = specs.get(loaded.source)?.get(loaded.entity);
    if (paths === undefined) {
      continue;
    }
    const outcome = await compactStream(deps, request, loaded, paths);
    deps.log?.info("lake_compaction_stream", { apply: request.apply, ...outcome });
    streams.push(outcome);
  }
  return { apply: request.apply, streams };
}

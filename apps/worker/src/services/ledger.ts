/**
 * The run ledger, for the callers that are not `runIngest`.
 *
 * The lake write API lands batches for scripts and orchestrators that are not the worker's
 * own runtime, and the process itself has to account for the runs it was in the middle of
 * when it last stopped. Both belong in the same ledger as every other run, and both go
 * through here so `handlers/lake.ts` and `server.ts` never speak to `ops.run` directly.
 */

import type { Logger } from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";
import {
  claimExternalRun,
  closeAbandoned,
  findRunById,
  recordExternalBatch,
  recordRefusals,
  type Run,
  type RunRefusal,
} from "@undercroft/db/repos";

import type { LandResult } from "./land.ts";

/** One run by id, for an operator watching a verb they started. `null` when there is none. */
export function findRun(exec: SqlExecutor, runId: string): Promise<Run | null> {
  return findRunById(exec, runId);
}

/**
 * Take an external caller's run id, or refuse it.
 *
 * `false` means the id already names another tenant's or source's run, and the caller must
 * be refused before a byte is landed under it.
 */
export function claimExternal(
  exec: SqlExecutor,
  input: { runId: string; tenantId: string; source: string },
): Promise<boolean> {
  return claimExternalRun(exec, {
    id: input.runId,
    tenantId: input.tenantId,
    source: input.source,
  });
}

/** Account for one landed batch: its counts on the run, its refusals beneath it. */
export async function recordExternal(
  exec: SqlExecutor,
  runId: string,
  landed: LandResult,
): Promise<void> {
  const refusals: RunRefusal[] = [];
  for (const result of landed.results) {
    if (result.status === "failed") {
      refusals.push({
        entity: result.entity,
        sourceRecordId: result.sourceRecordId,
        reason: result.reason ?? "refused",
      });
    }
  }
  await recordRefusals(exec, runId, refusals);
  await recordExternalBatch(exec, runId, {
    created: landed.created,
    unchanged: landed.unchanged,
    refused: landed.failed,
  });
}

/**
 * Close every run the previous process left running.
 *
 * A worker that restarts mid-run cannot resume it: the job lived in its memory. Left as
 * `running`, the row would hold `run_one_running` against every later run of the same
 * pair, forever. Closing it `failed` with a reason is the honest record and the release.
 */
export async function closeAbandonedRuns(exec: SqlExecutor, log?: Logger): Promise<number> {
  const closed = await closeAbandoned(exec, "the worker restarted while this run was in progress");
  if (closed.length > 0) {
    log?.warn("runs_abandoned", { count: closed.length, runIds: closed });
  }
  return closed.length;
}

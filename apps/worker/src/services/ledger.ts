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
 * What a run closed at boot says for itself.
 *
 * Such a run died with the process, so it never wrote its counts, and the row reads 0 of
 * everything. The old sentence, "the worker restarted while this run was in progress", sat
 * beside those zeroes and together they read as "this run landed nothing" whether or not it
 * had -- a run lands and projects a chunk at a time, so one killed an hour in may have landed
 * thousands -- and an operator reading the pair concluded a mailbox could never finish (issue
 * #196). So the sentence now says the one thing the zeroes cannot: they are not a count.
 *
 * It names a kill, and since ADR 0056 a kill is all it can mean. A run the worker stopped ON
 * PURPOSE settles itself, with its real counts, under `RUN_STOPPED` (ADR 0051); one still busy
 * when a graceful stop ran out of time is closed by the stopping process, under `RUN_CUT_OFF`
 * (`shutdown.ts`). What is left for the boot is a process that had no chance to say anything:
 * SIGKILL, the OOM killer, a crash, or a shutdown that could not reach the database.
 */
export const RUN_ABANDONED =
  "the worker stopped abruptly while this run was in progress (it was killed or ran out of " +
  "memory), so the run could not record its counts; the zeroes are not a count -- anything " +
  "it landed before then is kept, and the next run does not land it twice";

/**
 * Close every run the previous process left running.
 *
 * A worker that dies mid-run cannot resume it: the job lived in its memory. Left as
 * `running`, the row would hold `run_one_running` against every later run of the same
 * pair, forever. Closing it `failed` with a reason is the honest record and the release.
 */
export async function closeAbandonedRuns(exec: SqlExecutor, log?: Logger): Promise<number> {
  const closed = await closeAbandoned(exec, RUN_ABANDONED);
  if (closed.length > 0) {
    log?.warn("runs_abandoned", { count: closed.length, runIds: closed });
  }
  return closed.length;
}

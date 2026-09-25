/**
 * What a stopping worker does with the runs it is in the middle of.
 *
 * `server.ts` owns the signal and the clock. It aborts `RunDeps.stop`, so every ingest heads
 * for its next safe point (ADR 0051), and then it asks this module to wait. What this module
 * owns is the end of that wait. A run that settled in time has recorded itself. A run that has
 * not is closed here, by the process, with a sentence that says what happened.
 *
 * Before this, the process exited with such a run still `running`, and the next boot closed it
 * as `RUN_ABANDONED`: _killed or ran out of memory_. Issue #219 is what that costs. Three Drive
 * ingests in one day were deploys that outlasted the drain, and the kernel had killed nothing,
 * but the ledger said "out of memory" and the reporter believed it. The boot cannot tell a
 * deploy from a kill. The stopping process can, so the record is written here. ADR 0056.
 */

import type { Logger } from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";
import { closeAbandoned } from "@undercroft/db/repos";

import { drainJobs } from "./jobs.ts";

/**
 * What a run says when the worker shut down before the run reached a point it could stop at.
 *
 * It says three things, as `RUN_STOPPED` and `RUN_ABANDONED` do, because the reader is deciding
 * whether to worry. Nothing was wrong with the source or with the worker's memory. The zeroes
 * are not a count. Running again is safe. It is not `RUN_STOPPED`, because that message
 * promises real counts, and this run never wrote any.
 */
export const RUN_CUT_OFF =
  "the worker was shut down (a deploy or a restart) before this run reached a point where it " +
  "could stop safely, so the run could not record its counts; the zeroes are not a count -- " +
  "anything it landed before then is kept, and the next run does not land it twice";

/**
 * Wait for every job in flight until `deadline` settles, then close the runs still going.
 * Answers whether everything settled in time.
 *
 * Closed means every `running` row, not a list of this process's run ids. That is the same
 * scope, on the same one-worker premise, as `closeAbandonedRuns`, which would close these rows
 * a few seconds later at the next boot anyway. Their counts are not written. They are in the
 * memory of jobs that are still running and will end with the process, and a number read
 * partway through a run is a count nobody finished. A run that settles before this statement
 * is not matched by it. One that settles after replaces this record with its real outcome,
 * which is the truer of the two.
 *
 * The deadline is a promise, not a number of milliseconds. The bound belongs to `server.ts`,
 * where `DRAIN_MS` is paired with the compose file's grace period, and a test can end the wait
 * at a moment it chooses instead of sleeping through it.
 */
export async function drainJobsBy(
  exec: SqlExecutor,
  deadline: Promise<unknown>,
  log?: Logger,
): Promise<boolean> {
  const drained = await Promise.race([drainJobs().then(() => true), deadline.then(() => false)]);
  if (!drained) {
    const closed = await closeAbandoned(exec, RUN_CUT_OFF);
    if (closed.length > 0) {
      log?.warn("runs_cut_off", { count: closed.length, runIds: closed });
    }
  }
  return drained;
}

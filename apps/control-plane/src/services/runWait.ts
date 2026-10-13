/**
 * Waiting for a run to settle (issue 440): what `runs.get` does with `waitSeconds`, so an agent
 * that started a run reads it once instead of re-reading it in a loop of its own.
 *
 * The wait decides nothing a reader could not. It answers early only with what the ledger says,
 * and when it runs out the run still says `running` -- there is no fourth status (ADR 0051), and
 * none is guessed. Re-read rather than notified: nothing in the ledger announces a change, and
 * one primary-key read a second does not justify building something that does.
 */

import { type Clock, systemClock } from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";
import { findChildRun, getRun, type Run } from "@undercroft/db/repos";

/** The longest `runs.get` waits for a run to settle, in seconds. Under every door's own timeout. */
export const MAX_WAIT_SECONDS = 50;

/**
 * How often a wait re-reads the run. One primary-key read a second is nothing to the database,
 * and an agent told a second late that its run ended has lost nothing.
 */
const WAIT_POLL_MS = 1000;

/**
 * How long after an ingest closes ok a wait still expects the transform it chains.
 *
 * `startIngestJob` opens the child only after the parent's own `done` settles, so a wait that
 * stopped at the parent's `ok` could answer `childRun: null` a moment before the child exists --
 * and an agent would read that as "nothing was built". The web leaf has the same gap and polls
 * through it for twenty seconds (`CHAIN_GRACE_MS` in `RunDetail.tsx`), at five-second steps; a
 * wait re-reads every second, so it needs less. Bounded, because an ingest of a tenant with no
 * dbt, or one that did not chain, will never grow a child, and the wait has nothing to buy.
 */
const CHAIN_GRACE_MS = 10_000;

const MS_PER_SECOND = 1000;

/** How long to wait for a run to settle, and what would stop the wait sooner. */
export interface RunWait {
  /** At most {@link MAX_WAIT_SECONDS}; the handler bounds it. */
  readonly seconds: number;
  /** The request's own: a client that hung up stops the wait instead of leaving it to run out. */
  readonly signal?: AbortSignal | undefined;
  /** The system clock unless a suite moves time itself. */
  readonly clock?: Clock;
}

/** Sleep `ms`, or less if `signal` aborts first. */
function pause(clock: Clock, ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal === undefined) {
    return clock.sleep(ms);
  }
  const aborting = signal;
  return new Promise((resolve) => {
    function done(): void {
      aborting.removeEventListener("abort", done);
      resolve();
    }
    aborting.addEventListener("abort", done);
    clock.sleep(ms).then(done, done);
  });
}

/** An ingest that closed ok a moment ago, whose chained transform may not exist yet. */
function mayStillChain(run: Run, now: number): boolean {
  return (
    run.kind === "ingest" &&
    run.status === "ok" &&
    run.endedAt !== null &&
    now - new Date(run.endedAt).getTime() < CHAIN_GRACE_MS
  );
}

/** Whether a wait has more to wait for: the run itself, or the transform it is about to chain. */
async function unsettled(exec: SqlExecutor, run: Run, now: number): Promise<boolean> {
  if (run.status === "running") {
    return true;
  }
  return mayStillChain(run, now) && (await findChildRun(exec, run.tenantId, run.id)) === null;
}

/**
 * The run once it is no longer `running` (and, for an ingest that closed ok, once the transform
 * it chains exists or the grace for it has passed) -- or as it stands when the wait runs out or
 * its request is gone. `null` for a run that is not this tenant's, at once.
 */
export async function settled(
  exec: SqlExecutor,
  tenantId: string,
  runId: string,
  wait: RunWait,
): Promise<Run | null> {
  const clock = wait.clock ?? systemClock;
  const deadline = clock.now().getTime() + wait.seconds * MS_PER_SECOND;
  let run = await getRun(exec, tenantId, runId);
  while (run !== null && wait.signal?.aborted !== true) {
    const now = clock.now().getTime();
    if (now >= deadline || !(await unsettled(exec, run, now))) {
      return run;
    }
    await pause(clock, Math.min(WAIT_POLL_MS, deadline - now), wait.signal);
    run = await getRun(exec, tenantId, runId);
  }
  return run;
}

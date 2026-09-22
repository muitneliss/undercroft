/**
 * The extract verb as a run in the ledger: open, read, close.
 *
 * Its own module rather than another entry in `jobs.ts` because that file is at its line
 * ceiling, and because this verb shares nothing with the other two beyond the machinery it
 * imports -- no chaining, no dbt, no spec directory.
 *
 * ITS OWN RUN, NOT AN INGEST'S TAIL. Reading a real tenant's documents is tens of minutes of
 * CPU. Chained to every sync it would make an ingest's duration a function of how much
 * reading is outstanding, and a failed read would look like a failed sync -- two different
 * facts wearing one status. The partial index on `(tenant_id, source, verb)` lets an extract
 * run beside the ingest that landed the documents rather than against it. ADR 0024.
 *
 * A DOCUMENT THAT COULD NOT BE READ IS NOT A FAILED RUN. It is a row carrying its reason, and
 * the run closes `ok` having said so. What fails the run is being unable to reach the
 * catalogue or the lake at all -- a different fact, wanting a different screen.
 */

import { REFUSAL_RETENTION_DAYS } from "@undercroft/contracts/runs";
import { describeError, newRunId } from "@undercroft/core";
import {
  closeRun,
  MAX_ERROR_CHARS,
  openRun,
  pruneRefusals,
  recordEntities,
  recordPendingBefore,
  recordRefusalReasons,
  recordRefusals,
  type RunTrigger,
} from "@undercroft/db/repos";

import { RunInProgress } from "../ingest.ts";
import { type JobDeps, track } from "../jobs.ts";
import { createRunJournal } from "../runJournal.ts";
import { type ExtractResult, runExtract } from "./runExtract.ts";

/** `NodeJS.ProcessEnv` holds `string | undefined`; a child's environment holds strings. */
function definedOnly(parent: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(parent)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

function messageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_CHARS);
}

/**
 * Everything the run has to say about itself, then the row that says it is over.
 *
 * ORDER IS THE POINT. A reader who sees `status: ok` and then watches the counts arrive a
 * moment later is watching the ledger contradict itself, so the counts, the refusals and the
 * rollup all land before `closeRun`.
 *
 * The prune goes last, after the run is closed, so a prune that fails cannot cost this run
 * its counts. It is opportunistic and done by the verb that writes the rows -- one DELETE does
 * not earn a scheduler -- and it is NAMED, because a store that prunes without saying so
 * cannot be told from one that is losing data (`raw-lake.md`). What it removes is the
 * per-document detail; the rollup is a different table and is never pruned, which is what
 * keeps "what were the 245" answerable a year later. ADR 0039.
 */
async function settle(
  exec: JobDeps["exec"],
  runId: string,
  journal: ReturnType<typeof createRunJournal>,
  result: ExtractResult,
): Promise<void> {
  const refused = result.refused + result.unreadable;

  await recordPendingBefore(exec, runId, result.pendingBefore);
  await recordEntities(exec, runId, [
    {
      entity: "documents",
      landed: result.read + refused,
      created: result.read,
      changed: 0,
      unchanged: 0,
      refused,
    },
  ]);
  await recordRefusals(exec, runId, result.refusals);
  await recordRefusalReasons(exec, runId, result.reasonCounts);
  await closeRun(exec, runId, {
    status: "ok",
    // `created` is documents that gained text; `refused` is those that left with a reason
    // instead. The ledger's own words for "read" and "would not read".
    created: result.read,
    refused,
  });
  journal.info("run_closed", { status: "ok", created: result.read });

  const removed = await pruneRefusals(exec, REFUSAL_RETENTION_DAYS);
  if (removed > 0) {
    journal.info("refusals_pruned", { removed, keptDays: REFUSAL_RETENTION_DAYS });
  }
}

export async function startExtractJob(
  deps: JobDeps,
  input: { source: string; tenantId: string; trigger: RunTrigger; triggeredBy: string },
): Promise<{ runId: string }> {
  const { extractSpawn } = deps;
  if (extractSpawn === undefined) {
    throw new Error("extract is not configured");
  }
  const runId = newRunId();
  const opened = await openRun(deps.exec, {
    id: runId,
    tenantId: input.tenantId,
    source: input.source,
    verb: "extract",
    trigger: input.trigger,
    triggeredBy: input.triggeredBy,
    parentRunId: null,
    releaseTag: deps.releaseTag ?? "",
  });
  if (!opened.ok) {
    throw new RunInProgress("extract", input.tenantId, opened.runId);
  }

  const log = deps.log?.child({ runId, tenantId: input.tenantId, source: input.source });
  const journal = createRunJournal({
    exec: deps.exec,
    runId,
    ...(log === undefined ? {} : { log }),
  });
  journal.info("run_opened", { verb: "extract", trigger: input.trigger });

  track(
    runExtract(
      {
        exec: deps.exec,
        lake: deps.lake,
        spawn: extractSpawn,
        journal,
        ...(deps.env === undefined ? {} : { env: definedOnly(deps.env) }),
      },
      { tenantId: input.tenantId, source: input.source, runId },
    ).then(
      async (result) => {
        await settle(deps.exec, runId, journal, result);
        await journal.flush();
      },
      async (error: unknown) => {
        await closeRun(deps.exec, runId, { status: "failed", error: messageOf(error) });
        journal.error("run_failed", describeError(error));
        await journal.flush();
      },
    ),
  );

  return { runId };
}

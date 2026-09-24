/**
 * Ingest: the whole vertical slice in one call, and the run that records it.
 *
 * Read a connector spec, drive the generic runtime, land into the lake, project into
 * `raw.records`. One of the two verbs the worker exposes -- `handlers/lake.ts` holds the
 * allowlist that fronts them, which is the privilege boundary: a compromised scheduler can
 * start these verbs and nothing else, which is why Kestra needs no Docker socket.
 *
 * The other verb, `transform`, spawns dbt as a subprocess in this image (ADR 0007).
 *
 * ## Every run is a row before it is anything else
 *
 * `runIngest` opens an `ops.run` row before it reads a byte and closes it whatever happens,
 * so a run that landed nothing still exists and a run that failed says why. What it refused
 * -- a record with no id, a document over the size ceiling -- goes to `ops.run_refusal`
 * with its reason, which is what CLAUDE.md rule 2 asks: recorded, never dropped. The
 * counts and refusals are gathered into a ledger as each entity finishes, so a run that
 * fails on its third entity still records the two it completed.
 *
 * A second run for the same (tenant, source) while one is in progress is refused by the
 * database, not by this code: `run_one_running` in `090_runs.sql` is what makes the rule
 * hold for every caller at once.
 *
 * ## A run the process stops is settled here too, with what it landed
 *
 * A deploy recreates the worker mid-run more often than anything else ends one early. When the
 * process asks (`RunDeps.stop`), the path stops at a safe boundary, writes what it landed into
 * the ledger and throws `RunStopped`, and the same `settle` a failure goes through records
 * those counts under `RUN_STOPPED` -- rather than the run staying `running` until the next boot
 * closes it with no counts at all. `failed`, because the source was not read to the end; the
 * error is what says nothing went wrong with it. ADR 0051.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { needsScope, parseSourceInstance, parseSpec } from "@undercroft/contracts";
import { describeError, newRunId, UndercroftError } from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";
import {
  closeRun,
  getConnection,
  openRun,
  readConnectionDetail,
  recordEntities,
  recordRefusals,
  type RunEntity,
  tenantExists,
} from "@undercroft/db/repos";
import { isGoogleSource, ScopeNotChosen } from "./google/collect.ts";
import { runGoogleIngest, runSpecIngest } from "./runPaths.ts";
import {
  type IngestResult,
  type Ledger,
  type RunDeps,
  type RunOpening,
  RunStopped,
} from "./runTypes.ts";
import { createRunJournal, type RunJournal } from "./runJournal.ts";

/** A run for the same (tenant, source) is already in progress. `runId` names it. */
export class RunInProgress extends UndercroftError {
  constructor(
    readonly source: string,
    readonly tenantId: string,
    readonly runId: string,
  ) {
    super(`${source} for tenant ${JSON.stringify(tenantId)} is already running as ${runId}`);
  }
}

/** No such tenant. Named so the handler can answer 404 rather than a constraint violation. */
export class UnknownTenant extends UndercroftError {
  constructor(readonly tenantId: string) {
    super(`tenant ${JSON.stringify(tenantId)} does not exist`);
  }
}

/**
 * The source has no usable grant, so no run is opened for it.
 *
 * Refused BEFORE a row exists, deliberately: a source nobody has connected would otherwise
 * fail on every tick and fill the ledger with runs that could never have read anything.
 */
export class ConnectionUnusable extends UndercroftError {
  constructor(
    readonly source: string,
    readonly tenantId: string,
    readonly status: string,
  ) {
    super(`${source} for tenant ${JSON.stringify(tenantId)} is ${status}, not connected`);
  }
}

/**
 * The source is not one a connection could have: a kind with an account suffix it cannot hold,
 * or a string that is not a connector id at all.
 *
 * Refused before anything reads it, because the spec path reads `${source}.yaml` from disk and
 * a source is a string a caller chose. ADR 0043.
 */
export class UnknownSource extends UndercroftError {
  constructor(readonly source: string) {
    super(`${JSON.stringify(source)} is not a source this platform reads`);
  }
}

export async function runIngest(
  deps: RunDeps,
  input: { source: string; tenantId: string } & RunOpening,
): Promise<IngestResult> {
  const started = await startIngest(deps, input);
  return started.done;
}

/**
 * Open the run and start it, returning its id before it has read a byte.
 *
 * The split exists for the HTTP verb: a run is minutes, an open connection is not the
 * place to hold one, and the caller wants the id to watch it by. `done` settles when the
 * run has been closed in the ledger, whichever way -- a failure is recorded and then
 * rethrown, so a caller that awaits it learns both.
 *
 * Everything that can refuse does so BEFORE a row is opened: an unknown tenant, a source
 * with no usable grant, a run already in progress. A refused start leaves no run behind.
 */
export async function startIngest(
  deps: RunDeps,
  input: { source: string; tenantId: string } & RunOpening,
): Promise<{ runId: string; done: Promise<IngestResult> }> {
  if (parseSourceInstance(input.source) === null) {
    throw new UnknownSource(input.source);
  }
  if (!(await tenantExists(deps.exec, input.tenantId))) {
    throw new UnknownTenant(input.tenantId);
  }
  await requireUsableConnection(deps, input);

  const runId = newRunId();
  const trigger = input.trigger ?? "schedule";
  const opened = await openRun(deps.exec, {
    id: runId,
    tenantId: input.tenantId,
    source: input.source,
    verb: "ingest",
    trigger,
    triggeredBy: input.triggeredBy ?? "",
    releaseTag: deps.releaseTag ?? "",
  });
  if (!opened.ok) {
    throw new RunInProgress(input.source, input.tenantId, opened.runId);
  }
  const log = deps.log?.child({ runId, tenantId: input.tenantId, source: input.source });
  // One narrator for both channels. Every line below goes to stdout as it always did AND
  // into `ops.run_event`, where the person who pressed Run now can read it.
  const journal = createRunJournal({
    exec: deps.exec,
    runId,
    ...(log === undefined ? {} : { log }),
  });
  journal.info("run_opened", { verb: "ingest", trigger });

  return {
    runId,
    done: execute(deps, { source: input.source, tenantId: input.tenantId, runId }, journal),
  };
}

async function execute(
  deps: RunDeps,
  input: { source: string; tenantId: string; runId: string },
  journal: RunJournal,
): Promise<IngestResult> {
  const { runId } = input;
  const ledger: Ledger = { entities: [], refusals: [] };
  try {
    if (isGoogleSource(input.source)) {
      await runGoogleIngest(
        deps,
        { source: input.source, tenantId: input.tenantId, runId },
        ledger,
        journal,
      );
    } else {
      await runSpecIngest(deps, input, ledger, journal);
    }
    await settle(deps.exec, runId, ledger, { status: "ok" });
    journal.info("run_closed", { status: "ok", ...totals(ledger) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await settle(deps.exec, runId, ledger, { status: "failed", error: message });
    if (error instanceof RunStopped) {
      // A warning, not an error: nothing about the source failed, and the totals are the
      // point -- they are what the reader checks to see that the stop lost nothing.
      journal.warn("run_stopped", totals(ledger));
    } else {
      // Everything goes to stdout as before; the journal keeps `errorMessage` out of the feed
      // itself, because a provider's sentence can quote the record that caused it and the
      // ledger's own `error` column is where that belongs. See `runJournal.ts`.
      journal.error("run_failed", { ...totals(ledger), ...describeError(error) });
    }
    await journal.flush();
    throw error;
  }
  await journal.flush();

  return { runId, source: input.source, entities: ledger.entities, refusals: ledger.refusals };
}

/**
 * A source that authenticates needs a connected grant before a run makes sense.
 *
 * A spec with `auth: none` needs no connection at all and is not asked for one; every other
 * source -- a Google collector, a bearer or OAuth spec -- must have a row that says
 * `connected`. Anything else (`disconnected`, `expired`, `error`, or no row) is refused
 * here, so the ledger never fills with runs that could not have read anything.
 */
async function requireUsableConnection(
  deps: Pick<RunDeps, "exec" | "specsDir">,
  input: { source: string; tenantId: string },
): Promise<void> {
  if (!isGoogleSource(input.source)) {
    const spec = parseSpec(readFileSync(join(deps.specsDir, `${input.source}.yaml`), "utf8"));
    if (spec.auth.kind === "none") {
      return;
    }
  }
  const connection = await getConnection(deps.exec, input.tenantId, input.source);
  if (connection === null || connection.status !== "connected") {
    throw new ConnectionUnusable(input.source, input.tenantId, connection?.status ?? "absent");
  }
  // A scoped source with nothing chosen is refused before a row is opened, for the same
  // reason the scheduler skips it: a run that could only fail, every tick, is noise.
  // `needsScope` decides whether the source is scoped at all, by its kind -- a guard here that
  // asked a set of kind names about the SOURCE waved every second mailbox straight past it.
  const detail = await readConnectionDetail(deps.exec, input.tenantId, input.source);
  if (needsScope(input.source, detail?.selectionJson ?? "{}")) {
    throw new ScopeNotChosen(input.source, input.tenantId);
  }
}

function totals(ledger: Ledger): {
  created: number;
  changed: number;
  unchanged: number;
  refused: number;
} {
  let created = 0;
  let changed = 0;
  let unchanged = 0;
  for (const e of ledger.entities) {
    created += e.loadedCreated;
    changed += e.loadedChanged;
    unchanged += e.loadedUnchanged;
  }
  return { created, changed, unchanged, refused: ledger.refusals.length };
}

/** Write what the ledger holds and close the row, in that order, so a reader of `ended_at` finds the rest. */
async function settle(
  exec: SqlExecutor,
  runId: string,
  ledger: Ledger,
  outcome: { status: "ok" | "failed"; error?: string },
): Promise<void> {
  const entities: RunEntity[] = ledger.entities.map((e) => ({
    entity: e.entity,
    landed: e.landed,
    created: e.loadedCreated,
    changed: e.loadedChanged,
    unchanged: e.loadedUnchanged,
    refused: e.refused,
  }));
  await recordEntities(exec, runId, entities);
  await recordRefusals(exec, runId, ledger.refusals);
  await closeRun(exec, runId, {
    status: outcome.status,
    ...totals(ledger),
    ...(outcome.error === undefined ? {} : { error: outcome.error }),
  });
}

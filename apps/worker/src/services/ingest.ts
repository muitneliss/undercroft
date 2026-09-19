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
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Fetcher } from "@undercroft/connector-runtime";
import { SCOPED_SOURCES, needsScope, parseScope, parseSpec } from "@undercroft/contracts";
import {
  type ByteFetcher,
  describeError,
  type Logger,
  newRunId,
  UndercroftError,
} from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";
import { runGoogleIngest, runSpecIngest } from "./runPaths.ts";
import {
  closeRun,
  ConnectionRegistryError,
  type Credential,
  getConnection,
  openRun,
  readConnectionDetail,
  recordEntities,
  recordRefusals,
  type RunEntity,
  type RunRefusal,
  type RunTrigger,
  setStatus,
  tenantExists,
} from "@undercroft/db/repos";
import { accessToken } from "@undercroft/db/services";
import type { LakeStore } from "@undercroft/lake";
import { isGoogleSource, ScopeNotChosen } from "./google/collect.ts";

/**
 * Run `fn` inside one transaction on one connection.
 *
 * Injected rather than constructed: building it needs a pool, and `layer-injected-deps`
 * keeps infrastructure above this layer. `server.ts` supplies `withTransaction(pool, fn)`.
 */
export type Transactor = <T>(fn: (tx: SqlExecutor) => Promise<T>) => Promise<T>;

/**
 * Exchanges a refresh token for a fresh credential.
 *
 * Named here rather than written out at each call site so the handler can speak about a
 * refresher without importing `@undercroft/db/repos` -- `layer-handler-no-repo` counts a
 * type-only import too, and rightly: a transport layer that knows the credential's shape is
 * one refactor away from knowing which table it lives in.
 */
export type Refresher = (refreshToken: string) => Promise<Credential>;

export interface RunDeps {
  readonly lake: LakeStore;
  readonly exec: SqlExecutor;
  readonly specsDir: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Injected in tests; the process wires the real `fetch`-backed fetcher. */
  readonly fetcher?: Fetcher;
  /** The byte-returning seam the Google collectors use. Injected in tests, as above. */
  readonly byteFetcher?: ByteFetcher;
  /**
   * Exchanges a refresh token for a fresh credential. Absent means this source cannot
   * refresh -- correct for a HubSpot private app, which has nothing to refresh with.
   */
  readonly refresher?: Refresher;
  /**
   * Required for the row lock to mean anything. `accessToken` reads the credential
   * `FOR UPDATE`, which only holds inside a transaction; on the autocommit executor it
   * locks for the statement and no longer, so two concurrent runs can both spend the same
   * rotating refresh token and destroy the connection. Absent falls back to autocommit,
   * which is safe only because no refresher is wired in that case.
   */
  readonly transactor?: Transactor;
  /** Where the run's opening, closing and failure are written. Absent means silence. */
  readonly log?: Logger;
}

export interface IngestResult {
  readonly runId: string;
  readonly source: string;
  readonly entities: {
    entity: string;
    landed: number;
    loadedCreated: number;
    loadedChanged: number;
    loadedUnchanged: number;
    refused: number;
  }[];
  /** Every record or document this run refused, with why. Never a payload. */
  readonly refusals: RunRefusal[];
}

/** What a run wants to know about why it was started. Both default to the scheduler's. */
export interface RunOpening {
  readonly trigger?: RunTrigger;
  /** An `app_user` uuid. Never an address: `ops.run` is readable by BI. */
  readonly triggeredBy?: string;
}

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
 * A usable access token, refreshing under a real row lock if one is close to expiry.
 *
 * The transaction is the whole point. `accessToken` takes `SELECT ... FOR UPDATE`, which
 * holds a lock only inside a transaction -- so running it on the autocommit executor gave a
 * lock that lasted one statement and protected nothing. That went unnoticed because no
 * refresher was ever supplied, which meant the refresh branch never ran. Wiring one makes
 * the lock load-bearing, so it has to be real in the same change.
 *
 * A failure rolls the transaction back, leaving the stored credential untouched. Losing a
 * rotated refresh token half-written costs the connection outright.
 *
 * The rollback takes one write with it that has to survive. `accessToken` marks a
 * connection `expired` and *then* throws when it cannot refresh, so inside a transaction
 * that status is rolled back by the very throw that earned it -- and the card in the UI
 * would keep reading "connected" forever while every run failed. "This needs re-consent" is
 * a durable fact about the credential rather than part of the attempt that failed, so it is
 * re-applied outside the transaction.
 *
 * Only for `ConnectionRegistryError`, which is the "cannot be refreshed" case. A refresher
 * that threw because Google's token endpoint was briefly down is a transient fault, and
 * marking a perfectly good connection expired over one would send a customer to re-consent
 * for nothing.
 */
export async function resolveToken(
  deps: Pick<RunDeps, "exec" | "env" | "refresher" | "transactor">,
  input: { source: string; tenantId: string },
): Promise<string> {
  const run: Transactor =
    deps.transactor ?? (<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> => fn(deps.exec));
  try {
    return await run((tx) =>
      accessToken(tx, input.tenantId, input.source, {
        ...(deps.refresher === undefined ? {} : { refresher: deps.refresher }),
        ...(deps.env === undefined ? {} : { env: deps.env }),
      }),
    );
  } catch (error) {
    if (error instanceof ConnectionRegistryError) {
      await setStatus(deps.exec, input.tenantId, input.source, "expired");
    }
    throw error;
  }
}

/** What a run has done so far, gathered as it goes so a failure still records the rest. */
export interface Ledger {
  readonly entities: IngestResult["entities"];
  readonly refusals: RunRefusal[];
}

/**
 * Ingest one source for one tenant: spec -> runtime -> lake -> raw.records, as one run.
 *
 * A token resolver is passed to the runtime that opens the sealed per-tenant credential
 * under a row lock; the worker holds the master key, the scheduler never sees it.
 *
 * Gmail and Drive take a different path from the same door. They are collectors rather than
 * specs -- see `google/collect.ts` and ADR 0015 -- so the caller still says
 * `{source, tenantId}` and does not have to know which kind of source it asked for.
 */
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
  });
  if (!opened.ok) {
    throw new RunInProgress(input.source, input.tenantId, opened.runId);
  }
  const log = deps.log?.child({ runId, tenantId: input.tenantId, source: input.source });
  log?.info("run_opened", { verb: "ingest", trigger });

  return {
    runId,
    done: execute(deps, { source: input.source, tenantId: input.tenantId, runId }, log),
  };
}

async function execute(
  deps: RunDeps,
  input: { source: string; tenantId: string; runId: string },
  log: Logger | undefined,
): Promise<IngestResult> {
  const { runId } = input;
  const ledger: Ledger = { entities: [], refusals: [] };
  try {
    if (isGoogleSource(input.source)) {
      await runGoogleIngest(
        deps,
        { source: input.source, tenantId: input.tenantId, runId },
        ledger,
      );
    } else {
      await runSpecIngest(deps, input, ledger);
    }
    await settle(deps.exec, runId, ledger, { status: "ok" });
    log?.info("run_closed", { status: "ok", ...totals(ledger) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await settle(deps.exec, runId, ledger, { status: "failed", error: message });
    log?.error("run_failed", { ...totals(ledger), ...describeError(error) });
    throw error;
  }

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
  if (SCOPED_SOURCES.has(input.source)) {
    const detail = await readConnectionDetail(deps.exec, input.tenantId, input.source);
    if (needsScope(input.source, detail?.selectionJson ?? "{}")) {
      throw new ScopeNotChosen(input.source, input.tenantId);
    }
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

/**
 * What a spec run reads, as the connection records it: the provider's account id, and the
 * entities the admin chose. `null` for each means "the spec decides" -- a source with no
 * organisation to name, or a choice that named no entities and so means all of them.
 */
export async function chosenFor(
  deps: Pick<RunDeps, "exec">,
  input: { source: string; tenantId: string },
): Promise<{ accountId: string | null; entities: string[] | null }> {
  const connection = await getConnection(deps.exec, input.tenantId, input.source);
  const detail = await readConnectionDetail(deps.exec, input.tenantId, input.source);
  const scope = detail === null ? null : parseScope(input.source, detail.selectionJson);
  const entities = scope?.kind === "xero" && scope.entities.length > 0 ? scope.entities : null;
  const accountId = connection?.externalAccountId ?? null;
  return { accountId: accountId === "" ? null : accountId, entities };
}

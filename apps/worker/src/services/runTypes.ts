/**
 * What a run is made of, declared once.
 *
 * `ingest.ts` holds the LEDGER -- how a run opens, what it records and how it settles -- and
 * `runPaths.ts` holds how the records are actually fetched. Both need these shapes and each
 * needs the other, so they live in a third module below both rather than in a cycle.
 *
 * `resolveToken` is here for the same reason and for one of its own: it is the only place
 * that decides a connection has EXPIRED, and that decision belongs beside the type carrying
 * the refresher rather than beside either path that spends the token.
 */

import type { Fetcher } from "@undercroft/connector-runtime";
import { type ByteFetcher, type Logger, UndercroftError } from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";
import type { Credential, RunRefusal, RunTrigger } from "@undercroft/db/repos";
import { ConnectionRegistryError, setStatus } from "@undercroft/db/repos";
import { accessToken } from "@undercroft/db/services";
import type { LakeStore } from "@undercroft/lake";

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
  /**
   * Which build is opening these runs -- `v1.16.0`, or `main@a1b2c3d` for a build cut from no
   * release. Absent is `""`, which the ledger renders as "this build did not say" rather than
   * guessing a version it cannot know.
   *
   * IT COMES FROM THE IMAGE, NOT THE DEPLOY POINTER. CI pushes the version tag AND `latest`,
   * and Dokploy tracks `latest` deliberately so there is never a version to keep in step by
   * hand -- which means the pointer carries no version at all, and the answer has to ride
   * inside the artifact (`deploy/Dockerfile.worker`). Read at the composition root like every
   * other configuration value; a layer below never reaches for `process.env` (`layering.md`).
   */
  readonly releaseTag?: string;
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
  /**
   * Aborted when the process has been told to stop -- a deploy recreating the container, an
   * operator's Ctrl-C. Absent means nothing will ever ask this run to stop early.
   *
   * A run that sees it stops at the next boundary where what it has landed is whole: between
   * two records on the spec path, between two harvest items on the Google path. It then
   * settles `failed` with {@link RunStopped}'s message and the counts it actually landed,
   * which is the difference from a kill: a killed run is closed at the next boot with no
   * counts at all, because nothing lived to write them. It is a SIGNAL rather than a callback
   * so the decision of when to look stays with the path that knows where its boundaries are.
   * Wired from `server.ts`, the only module that may know a process exists (`layering.md`).
   */
  readonly stop?: AbortSignal;
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

/**
 * The ledger's error for a run the worker stopped on purpose.
 *
 * It has to say three things, because the person reading it is deciding whether anything was
 * lost: that nothing about the SOURCE went wrong, that the counts on the run are real rather
 * than a placeholder, and that pressing Run again is neither needed nor harmful. The boot-time
 * message for a run that was KILLED is deliberately different (`ledger.ts`): there the counts
 * are not known, and it must not read as if they were zero.
 */
export const RUN_STOPPED =
  "the worker was shut down while this run was in progress, usually for a deploy; the run " +
  "stopped at a safe point, the counts on it are what it landed, and that is kept -- the " +
  "next run carries on from there";

/**
 * A run stopped because the process was told to, at a point where what it landed is whole.
 *
 * Thrown by a run path AFTER it has written what it landed into the {@link Ledger}, so the
 * settle that catches it records real counts. Declared here rather than beside `RunInProgress`
 * in `ingest.ts` because `runPaths.ts` throws it, and `ingest.ts` imports `runPaths.ts`.
 * `status` stays `failed` -- `ops.run` has no third outcome, and a run that did not read its
 * whole source did not succeed; the message is what tells this apart from a fault. ADR 0051.
 */
export class RunStopped extends UndercroftError {
  constructor() {
    super(RUN_STOPPED);
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
/**
 * The fallback transactor: run on the executor as given, opening no transaction.
 *
 * Safe only because it is reached when no refresher is wired, which is when the refresh
 * branch -- the one the row lock protects -- never runs. See `RunDeps.transactor`.
 */
function autocommit(exec: SqlExecutor): Transactor {
  return async <T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> => await fn(exec);
}

export async function resolveToken(
  deps: Pick<RunDeps, "exec" | "env" | "refresher" | "transactor">,
  input: { source: string; tenantId: string },
): Promise<string> {
  const run: Transactor = deps.transactor ?? autocommit(deps.exec);
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

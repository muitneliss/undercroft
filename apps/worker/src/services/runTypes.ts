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
import type { ByteFetcher, Logger } from "@undercroft/core";
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

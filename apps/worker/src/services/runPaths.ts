/**
 * The two paths a run can take from the same door.
 *
 * A spec source is read by the generic connector runtime; Gmail and Drive are collectors
 * rather than specs (ADR 0015) and take a different route to the same ledger. Split from
 * `ingest.ts` so that file holds the LEDGER -- what a run records and how it settles -- and
 * this one holds how the records are actually fetched.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createFetcher,
  type Fetcher,
  readEntity,
  type RunContext,
} from "@undercroft/connector-runtime";
import { type ConnectorSpec, parseScope, parseSpec } from "@undercroft/contracts";
import { type ByteFetcher, createByteFetcher, type Logger } from "@undercroft/core";
import { createGoogleApi } from "./google/api.ts";
import { type GoogleSource, runGoogleCollect } from "./google/collect.ts";
import { landRecords, type RecordToLand } from "./land.ts";
import { loadStreamToRaw } from "./loadToRaw.ts";
import type { RunRefusal, RunTrigger } from "@undercroft/db/repos";
import { getConnection, readConnectionDetail } from "@undercroft/db/repos";
import type { SqlExecutor } from "@undercroft/db";
import { ConnectionRegistryError, setStatus } from "@undercroft/db/repos";
import { accessToken } from "@undercroft/db/services";
import type { Credential } from "@undercroft/db/repos";
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

/**
 * The Google path, reported in the same shape as a spec run.
 *
 * Documents are counted as their own entity beside the records: from the caller's side one
 * run landed a number of things, and a scheduler that saw a green run with a zero count
 * would have no way to tell "the mailbox is empty" from "the PDFs all failed".
 */
export async function runGoogleIngest(
  deps: RunDeps,
  input: { source: GoogleSource; tenantId: string; runId: string },
  ledger: Ledger,
): Promise<void> {
  const api = createGoogleApi(input.source, {
    fetcher: deps.byteFetcher ?? createByteFetcher(),
    token: () => resolveToken(deps, input),
  });

  const result = await runGoogleCollect({ lake: deps.lake, exec: deps.exec, api }, input);

  const records = result.refusals.filter((r) => r.entity !== "documents").length;
  ledger.entities.push(
    {
      entity: input.source === "gmail" ? "messages" : "files",
      landed: result.records.landed,
      loadedCreated: result.records.loadedCreated,
      loadedChanged: result.records.loadedChanged,
      loadedUnchanged: result.records.loadedUnchanged,
      refused: records,
    },
    {
      entity: "documents",
      landed: result.documents.created + result.documents.unchanged,
      loadedCreated: result.documents.created,
      loadedChanged: 0,
      loadedUnchanged: result.documents.unchanged,
      refused: result.refusals.length - records,
    },
  );
  ledger.refusals.push(...result.refusals);
}

/**
 * The context one run hands the connector runtime.
 *
 * A token resolver is attached only when the connector authenticates: under
 * `exactOptionalPropertyTypes` an explicit `undefined` is not the same as omitting the key,
 * and a spec with `auth.kind === "none"` must not be handed a resolver it may then call. The
 * account id -- the Xero organisation chosen after consent -- is attached the same way, and
 * the runtime refuses to send a request without it where the spec names it.
 */
function runContextFor(
  deps: RunDeps,
  spec: ConnectorSpec,
  input: { source: string; tenantId: string },
  accountId: string | null,
): RunContext {
  return {
    fetcher: deps.fetcher ?? createFetcher(spec.defaults.timeoutMs),
    // Only attach a token resolver when the connector authenticates. Under
    // exactOptionalPropertyTypes an explicit `undefined` is not the same as omitting it.
    ...(spec.auth.kind === "none"
      ? {}
      : {
          token: () => resolveToken(deps, input),
        }),
    // The provider's account id -- the Xero organisation chosen after consent -- for the
    // header the spec names. The runtime refuses to send a request without it.
    ...(accountId === null ? {} : { accountId }),
  };
}

export async function runSpecIngest(
  deps: RunDeps,
  input: { source: string; tenantId: string; runId: string },
  ledger: Ledger,
): Promise<void> {
  const spec = parseSpec(readFileSync(join(deps.specsDir, `${input.source}.yaml`), "utf8"));
  const chosen = await chosenFor(deps, input);

  const ctx = runContextFor(deps, spec, input, chosen.accountId);

  // Ids per entity, so a `batch-from` relation can read against the entity it references.
  // Spec order matters: the referenced entity must be declared before the relation, which
  // the spec schema checks by refusing an unknown reference.
  const idsByEntity = new Map<string, string[]>();

  // What the admin chose to read, where they chose. Spec order is kept, so a relation still
  // follows the entity it reads against.
  const entities =
    chosen.entities === null
      ? spec.entities
      : spec.entities.filter((entity) => chosen.entities?.includes(entity.name) === true);

  for (const entity of entities) {
    const entityCtx: RunContext =
      entity.request.kind === "batch-from"
        ? { ...ctx, sourceIds: idsByEntity.get(entity.request.entity) ?? [] }
        : ctx;

    const batch: RecordToLand[] = [];
    for await (const record of readEntity(spec, entity, entityCtx)) {
      batch.push({
        entity: record.entity,
        sourceRecordId: record.sourceRecordId,
        sourceUpdatedAt: record.sourceUpdatedAt,
        payloadText: record.payloadText,
      });
    }
    idsByEntity.set(
      entity.name,
      batch.map((r) => r.sourceRecordId),
    );
    const landed = await landRecords(deps.lake, {
      source: input.source,
      tenantId: input.tenantId,
      runId: input.runId,
      records: batch,
    });
    const loaded = await loadStreamToRaw(deps.exec, deps.lake, {
      source: input.source,
      tenantId: input.tenantId,
      entity: entity.name,
    });
    for (const result of landed.results) {
      if (result.status === "failed") {
        ledger.refusals.push({
          entity: result.entity,
          sourceRecordId: result.sourceRecordId,
          reason: result.reason ?? "refused",
        });
      }
    }
    ledger.entities.push({
      entity: entity.name,
      landed: landed.created + landed.unchanged,
      loadedCreated: loaded.created,
      loadedChanged: loaded.changed,
      loadedUnchanged: loaded.unchanged,
      refused: landed.failed,
    });
  }
}

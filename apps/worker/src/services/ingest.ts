/**
 * Ingest: the whole vertical slice in one call.
 *
 * Read a connector spec, drive the generic runtime, land into the lake, project into
 * `raw.records`. One of the two verbs the worker exposes -- `handlers/lake.ts` holds the
 * allowlist that fronts them, which is the privilege boundary: a compromised scheduler can
 * start these verbs and nothing else, which is why Kestra needs no Docker socket.
 *
 * The other verb, `transform`, hands off to dbt in its own container; the worker does not
 * embed dbt.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createFetcher,
  type Fetcher,
  type RunContext,
  readEntity,
} from "@undercroft/connector-runtime";
import { parseSpec } from "@undercroft/contracts";
import { type ByteFetcher, createByteFetcher, newRunId } from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";
import { accessToken } from "@undercroft/db/services";
import type { LakeStore } from "@undercroft/lake";
import { ConnectionRegistryError, type Credential, setStatus } from "@undercroft/db/repos";
import { createGoogleApi } from "./google/api.ts";
import { type GoogleSource, isGoogleSource, runGoogleCollect } from "./google/collect.ts";
import { landRecords, type RecordToLand } from "./land.ts";
import { loadStreamToRaw } from "./loadToRaw.ts";

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
}

export interface IngestResult {
  readonly runId: string;
  readonly source: string;
  readonly entities: {
    entity: string;
    landed: number;
    loadedCreated: number;
    loadedChanged: number;
  }[];
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

/**
 * Ingest one source for one tenant: spec -> runtime -> lake -> raw.records.
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
  input: { source: string; tenantId: string },
): Promise<IngestResult> {
  if (isGoogleSource(input.source)) {
    return await runGoogleIngest(deps, { source: input.source, tenantId: input.tenantId });
  }
  return await runSpecIngest(deps, input);
}

/**
 * The Google path, reported in the same shape as a spec run.
 *
 * Documents are counted into `landed` alongside records: from the caller's side one run
 * landed a number of things, and a scheduler that saw a green run with a zero count would
 * have no way to tell "the mailbox is empty" from "the PDFs all failed".
 */
async function runGoogleIngest(
  deps: RunDeps,
  input: { source: GoogleSource; tenantId: string },
): Promise<IngestResult> {
  const api = createGoogleApi(input.source, {
    fetcher: deps.byteFetcher ?? createByteFetcher(),
    token: () => resolveToken(deps, input),
  });

  const result = await runGoogleCollect({ lake: deps.lake, exec: deps.exec, api }, input);

  return {
    runId: result.runId,
    source: result.source,
    entities: [
      {
        entity: input.source === "gmail" ? "messages" : "files",
        landed: result.records.landed,
        loadedCreated: result.records.loadedCreated,
        loadedChanged: result.records.loadedChanged,
      },
      {
        entity: "documents",
        landed: result.documents.created + result.documents.unchanged,
        loadedCreated: result.documents.created,
        loadedChanged: 0,
      },
    ],
  };
}

async function runSpecIngest(
  deps: RunDeps,
  input: { source: string; tenantId: string },
): Promise<IngestResult> {
  const runId = newRunId();
  const spec = parseSpec(readFileSync(join(deps.specsDir, `${input.source}.yaml`), "utf8"));

  const ctx: RunContext = {
    fetcher: deps.fetcher ?? createFetcher(spec.defaults.timeoutMs),
    // Only attach a token resolver when the connector authenticates. Under
    // exactOptionalPropertyTypes an explicit `undefined` is not the same as omitting it.
    ...(spec.auth.kind === "none"
      ? {}
      : {
          token: () => resolveToken(deps, input),
        }),
  };

  const entities: IngestResult["entities"] = [];
  // Ids per entity, so a `batch-from` relation can read against the entity it references.
  // Spec order matters: the referenced entity must be declared before the relation, which
  // the spec schema checks by refusing an unknown reference.
  const idsByEntity = new Map<string, string[]>();

  for (const entity of spec.entities) {
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
      runId,
      records: batch,
    });
    const loaded = await loadStreamToRaw(deps.exec, deps.lake, {
      source: input.source,
      tenantId: input.tenantId,
      entity: entity.name,
    });
    entities.push({
      entity: entity.name,
      landed: landed.created + landed.unchanged,
      loadedCreated: loaded.created,
      loadedChanged: loaded.changed,
    });
  }

  return { runId, source: input.source, entities };
}

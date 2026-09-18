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

import { parseSpec } from "@undercroft/contracts";
import { newRunId } from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";
import { accessToken } from "@undercroft/db/services";
import type { LakeStore } from "@undercroft/lake";
import {
  createFetcher,
  type Fetcher,
  readEntity,
  type RunContext,
} from "@undercroft/connector-runtime";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { landRecords, type RecordToLand } from "./land.ts";
import { loadStreamToRaw } from "./loadToRaw.ts";

export interface RunDeps {
  readonly lake: LakeStore;
  readonly exec: SqlExecutor;
  readonly specsDir: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Injected in tests; the process wires the real `fetch`-backed fetcher. */
  readonly fetcher?: Fetcher;
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
 * Ingest one source for one tenant: spec -> runtime -> lake -> raw.records.
 *
 * A token resolver is passed to the runtime that opens the sealed per-tenant credential
 * under a row lock; the worker holds the master key, the scheduler never sees it.
 */
export async function runIngest(
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
          token: () =>
            accessToken(deps.exec, input.tenantId, input.source, deps.env ? { env: deps.env } : {}),
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

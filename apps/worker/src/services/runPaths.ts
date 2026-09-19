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
import { createFetcher, type RunContext, readEntity } from "@undercroft/connector-runtime";
import { parseSpec, type ConnectorSpec } from "@undercroft/contracts";
import { createByteFetcher } from "@undercroft/core";
import { createGoogleApi } from "./google/api.ts";
import { type GoogleSource, runGoogleCollect } from "./google/collect.ts";
import { landRecords, type RecordToLand } from "./land.ts";
import { loadStreamToRaw } from "./loadToRaw.ts";
import { chosenFor, type IngestResult, type Ledger, resolveToken, type RunDeps } from "./ingest.ts";

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

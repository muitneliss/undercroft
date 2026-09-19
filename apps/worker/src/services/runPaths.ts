/**
 * The two paths a run can take from the same door.
 *
 * A spec source is read by the generic connector runtime; Gmail and Drive are collectors
 * rather than specs (ADR 0015) and take a different route to the same ledger. Split from
 * `ingest.ts` so that file holds the LEDGER -- what a run records, how it opens and how it
 * settles -- and this one holds how the records are actually fetched.
 *
 * Both paths write into the same `Ledger` as they go and narrate into the same `RunJournal`,
 * so a failure halfway still records what the first half did. That is `connectors.md`'s rule
 * that a failure raises rather than returning an empty stream, kept on the worker's side.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createFetcher, readEntity, type RunContext } from "@undercroft/connector-runtime";
import { type ConnectorSpec, parseScope, parseSpec } from "@undercroft/contracts";
import { createByteFetcher } from "@undercroft/core";
import { getConnection, readConnectionDetail } from "@undercroft/db/repos";

import { createGoogleApi } from "./google/api.ts";
import { type GoogleSource, runGoogleCollect } from "./google/collect.ts";
import type { Ledger, RunDeps } from "./runTypes.ts";
import { resolveToken } from "./runTypes.ts";
import { landRecords, type RecordToLand } from "./land.ts";
import { loadStreamToRaw } from "./loadToRaw.ts";
import type { RunJournal } from "./runJournal.ts";

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
  journal: RunJournal,
): Promise<void> {
  const api = createGoogleApi(input.source, {
    fetcher: deps.byteFetcher ?? createByteFetcher(),
    token: () => resolveToken(deps, input),
  });

  const result = await runGoogleCollect({ lake: deps.lake, exec: deps.exec, api, journal }, input);

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
  for (const entity of ledger.entities) {
    journal.info("entity_done", {
      entity: entity.entity,
      landed: entity.landed,
      created: entity.loadedCreated,
      changed: entity.loadedChanged,
      unchanged: entity.loadedUnchanged,
      refused: entity.refused,
    });
  }
}

/** What one spec run needs, gathered once before the first entity is read. */
interface SpecRun {
  readonly spec: ConnectorSpec;
  readonly ctx: RunContext;
  readonly entities: ConnectorSpec["entities"];
}

/**
 * Open a spec run: the spec, the request context, and which entities the admin chose.
 *
 * Spec ORDER is kept through the filter, because a `batch-from` relation reads against ids
 * harvested from an entity declared before it; the spec schema refuses an unknown reference,
 * and a reordered list would turn that check into a run that silently read nothing.
 */
async function openSpecRun(
  deps: RunDeps,
  input: { source: string; tenantId: string },
): Promise<SpecRun> {
  const spec = parseSpec(readFileSync(join(deps.specsDir, `${input.source}.yaml`), "utf8"));
  const chosen = await chosenFor(deps, input);

  const ctx: RunContext = {
    fetcher: deps.fetcher ?? createFetcher(spec.defaults.timeoutMs),
    // Only attach a token resolver when the connector authenticates. Under
    // exactOptionalPropertyTypes an explicit `undefined` is not the same as omitting it.
    ...(spec.auth.kind === "none"
      ? {}
      : { token: (): Promise<string> => resolveToken(deps, input) }),
    // The provider's account id -- the Xero organisation chosen after consent -- for the
    // header the spec names. The runtime refuses to send a request without it.
    ...(chosen.accountId === null ? {} : { accountId: chosen.accountId }),
  };

  const entities =
    chosen.entities === null
      ? spec.entities
      : spec.entities.filter((entity) => chosen.entities?.includes(entity.name) === true);

  return { spec, ctx, entities };
}

/** Everything one entity's read reports to, held together so it is three arguments not six. */
interface EntityRun {
  readonly deps: RunDeps;
  readonly input: { source: string; tenantId: string; runId: string };
  readonly spec: ConnectorSpec;
  readonly ledger: Ledger;
  readonly journal: RunJournal;
}

/** What one entity's land and load did, before it is written into the ledger. */
interface EntityOutcome {
  readonly landed: Awaited<ReturnType<typeof landRecords>>;
  readonly loaded: Awaited<ReturnType<typeof loadStreamToRaw>>;
}

/** Write one entity's outcome into the ledger, and narrate it. */
function recordEntity(run: EntityRun, entity: string, outcome: EntityOutcome): void {
  const { landed, loaded } = outcome;
  for (const result of landed.results) {
    if (result.status === "failed") {
      run.ledger.refusals.push({
        entity: result.entity,
        sourceRecordId: result.sourceRecordId,
        reason: result.reason ?? "refused",
      });
    }
  }
  run.ledger.entities.push({
    entity,
    landed: landed.created + landed.unchanged,
    loadedCreated: loaded.created,
    loadedChanged: loaded.changed,
    loadedUnchanged: loaded.unchanged,
    refused: landed.failed,
  });
  run.journal.info("entity_done", {
    entity,
    landed: landed.created + landed.unchanged,
    created: loaded.created,
    changed: loaded.changed,
    unchanged: loaded.unchanged,
    refused: landed.failed,
  });
}

/**
 * Read one entity, land it, load it, and record what it did. Returns the ids it saw.
 *
 * The ids come back so a `batch-from` relation declared after this entity can read against
 * them. The whole entity is buffered before landing because the lake write is one create-only
 * call per record and the ids are needed as a set; a source large enough for that to matter
 * would want a different shape, and none is.
 */
async function ingestEntity(
  run: EntityRun,
  entity: ConnectorSpec["entities"][number],
  ctx: RunContext,
): Promise<string[]> {
  const { deps, input, spec, journal } = run;
  journal.info("entity_started", { entity: entity.name });

  const batch: RecordToLand[] = [];
  for await (const record of readEntity(spec, entity, ctx)) {
    batch.push({
      entity: record.entity,
      sourceRecordId: record.sourceRecordId,
      sourceUpdatedAt: record.sourceUpdatedAt,
      payloadText: record.payloadText,
    });
    // Coalesced by the journal: a line per record would be the run written twice.
    journal.progress("records_read", { entity: entity.name, read: batch.length });
  }

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

  recordEntity(run, entity.name, { landed, loaded });
  return batch.map((r) => r.sourceRecordId);
}

export async function runSpecIngest(
  deps: RunDeps,
  input: { source: string; tenantId: string; runId: string },
  ledger: Ledger,
  journal: RunJournal,
): Promise<void> {
  const { spec, ctx, entities } = await openSpecRun(deps, input);
  const run: EntityRun = { deps, input, spec, ledger, journal };

  // Ids per entity, so a `batch-from` relation can read against the entity it references.
  const idsByEntity = new Map<string, string[]>();

  for (const entity of entities) {
    const entityCtx: RunContext =
      entity.request.kind === "batch-from"
        ? { ...ctx, sourceIds: idsByEntity.get(entity.request.entity) ?? [] }
        : ctx;
    idsByEntity.set(entity.name, await ingestEntity(run, entity, entityCtx));
  }
}

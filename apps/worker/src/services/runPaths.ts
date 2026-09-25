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
 *
 * Both honour `RunDeps.stop` the same way too: stop at a boundary where what landed is whole,
 * write what landed into the ledger, and only then throw {@link RunStopped} -- so the settle
 * that catches it records real counts, and nothing a finished read would have written after
 * (a watermark, a tombstone) is written. ADR 0051.
 */

import { laterStamp, readEntity, type RunContext } from "@undercroft/connector-runtime";
import { type ConnectorSpec, sourceKind } from "@undercroft/contracts";
import { createByteFetcher } from "@undercroft/core";

import { readSyncCursor, writeSyncCursor } from "../repos/syncCursor.ts";
import { createGoogleApi, googleMinIntervalMs } from "./google/api.ts";
import { type CollectResult, runGoogleCollect } from "./google/collect.ts";
import type { LandSummary, RefusalWriter } from "./landing.ts";
import { createRecordSink } from "./recordSink.ts";
import type { Ledger, RunDeps } from "./runTypes.ts";
import { resolveToken, RunStopped } from "./runTypes.ts";
import type { RunJournal } from "./runJournal.ts";
import { type EntityRead, openSpecRun } from "./specRun.ts";

/**
 * The Google path, reported in the same shape as a spec run.
 *
 * Documents are counted as their own entity beside the records: from the caller's side one
 * run landed a number of things, and a scheduler that saw a green run with a zero count
 * would have no way to tell "the mailbox is empty" from "the PDFs all failed".
 */
export async function runGoogleIngest(
  deps: RunDeps,
  input: { source: string; tenantId: string; runId: string },
  ledger: Ledger,
  journal: RunJournal,
): Promise<void> {
  const api = createGoogleApi(input.source, {
    fetcher: deps.byteFetcher ?? createByteFetcher(),
    token: () => resolveToken(deps, input),
    // Read from the injected environment, never from `process.env` at this layer. A
    // deployment whose Cloud project enforces a different rate than the 2-4
    // messages.get/second this default paces for sets the env var; a bad value raises here
    // rather than silently pacing at the rate that killed a backfill. See `google/api.ts`.
    minIntervalMs: googleMinIntervalMs(deps.env),
  });

  const result = await runGoogleCollect(
    {
      lake: deps.lake,
      exec: deps.exec,
      api,
      journal,
      ...(deps.stop === undefined ? {} : { stop: deps.stop }),
    },
    input,
  );

  const recordsEntity = sourceKind(input.source) === "gmail" ? "messages" : "files";
  ledger.entities.push(...entitiesOf(result, recordsEntity));
  ledger.refusals.push(...result.refusals);
  for (const entity of ledger.entities) {
    journal.info("entity_done", {
      entity: entity.entity,
      landed: entity.landed,
      created: entity.loadedCreated,
      changed: entity.loadedChanged,
      unchanged: entity.loadedUnchanged,
      refused: entity.refused,
      // Only on the RECORD entity, and only when there is one, because it answers a
      // question only the record entity is asked: in steady state a run lands nothing, and
      // `landed: 0` alone reads the same whether the mailbox is empty or unchanged. A
      // document's own `skipped` is a size refusal, which is a different fact with the same
      // name; it is reported in `documents_landed` and deliberately not conflated here.
      ...(entity.entity === recordsEntity &&
      result.records.skipped !== null &&
      result.records.skipped > 0
        ? { skipped: result.records.skipped }
        : {}),
    });
  }
  // After the ledger has the counts, never before: they are the point of stopping gracefully.
  if (result.stopped) {
    throw new RunStopped();
  }
}

/** A collection as the ledger's two entities: its records, and its documents beside them. */
function entitiesOf(result: CollectResult, recordsEntity: string): Ledger["entities"] {
  const records = result.refusals.filter((r) => r.entity !== "documents").length;
  return [
    {
      entity: recordsEntity,
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
  ];
}

/** Everything one entity's read reports to, held together so it is three arguments not six. */
interface EntityRun {
  readonly deps: RunDeps;
  readonly input: { source: string; tenantId: string; runId: string };
  readonly spec: ConnectorSpec;
  readonly ledger: Ledger;
  readonly journal: RunJournal;
}

/** Write one entity's outcome into the ledger, and narrate it. */
function recordEntity(run: EntityRun, entity: string, landed: LandSummary): void {
  run.ledger.entities.push({
    entity,
    landed: landed.landed,
    loadedCreated: landed.loaded.created,
    loadedChanged: landed.loaded.changed,
    loadedUnchanged: landed.loaded.unchanged,
    refused: landed.refused,
  });
  run.journal.info("entity_done", {
    entity,
    landed: landed.landed,
    created: landed.loaded.created,
    changed: landed.loaded.changed,
    unchanged: landed.loaded.unchanged,
    refused: landed.refused,
  });
}

/**
 * Refusals into the run's ledger, which `settle` writes when the run closes.
 *
 * The same binding the Google path uses, and for the same reason: `ops.run_refusal`
 * references `ops.run(id)`, so where a refusal goes is a fact about the caller rather than
 * about landing. One writer for a run's refusals keeps the count `run_closed` reports and
 * the rows in the table from being two answers.
 */
function intoLedger(ledger: Ledger): RefusalWriter {
  return (refusals): Promise<void> => {
    ledger.refusals.push(...refusals);
    return Promise.resolve();
  };
}

/**
 * Read one entity, land it as it arrives, and record what it did.
 *
 * `readEntity` has always been an async generator; this used to gather everything it streamed
 * into one array and land it at the end, which is the shape that reached the worker's 1 GiB
 * limit and lost a 76-minute run. The records now go straight into a {@link createRecordSink},
 * which holds one chunk and projects each one, so a crash costs a chunk rather than a run.
 * `read` is counted explicitly because there is no longer an array whose length to report.
 *
 * `ids` is somewhere to put this entity's ids, or `null` when no `batch-from` relation reads
 * against this entity -- see {@link referencedEntities}.
 *
 * ## The watermark advances here, and only by getting to the end
 *
 * There is no flag saying the read completed: the cursor write sits after the `for await` and
 * after `close()`, so a throw anywhere in between skips it by control flow. That matters more
 * than it looks. A watermark advanced past a read that died halfway would ask the next run for
 * records after a mark that records below it never reached -- and on a source that does not
 * order its pages by the incremental field, which is most of them, those records are gone from
 * the raw lake permanently. Not advancing costs a re-read, which is `unchanged` twice over.
 *
 * A STOP is the one early exit that is not a throw from inside the loop, and it keeps that
 * property all the same. It breaks out -- between two records, after the second has gone into
 * the sink -- so the sink can land what was read and the ledger can count it, and then throws
 * {@link RunStopped} from above the cursor write. A stopped read is a partial read, and the
 * paragraph above is exactly why a partial read must not move the mark.
 */
async function ingestEntity(
  run: EntityRun,
  { entity, requestKey }: EntityRead,
  ctx: RunContext,
  ids: string[] | null,
): Promise<void> {
  const { deps, input, spec, journal } = run;
  journal.info("entity_started", { entity: entity.name });

  const stream = { source: input.source, tenantId: input.tenantId, entity: entity.name };
  const { incremental } = entity;
  const since =
    incremental === undefined
      ? null
      : await readSyncCursor(deps.exec, stream, { format: incremental.format, requestKey });

  const sink = createRecordSink(
    { lake: deps.lake, exec: deps.exec, refuse: intoLedger(run.ledger) },
    { source: input.source, tenantId: input.tenantId, runId: input.runId },
  );
  const entityCtx: RunContext = { ...ctx, ...(since === null ? {} : { since }) };

  let read = 0;
  let mark: string | null = null;
  let stopped = false;
  for await (const record of readEntity(spec, entity, entityCtx)) {
    await sink.add({
      entity: record.entity,
      sourceRecordId: record.sourceRecordId,
      sourceUpdatedAt: record.sourceUpdatedAt,
      payloadText: record.payloadText,
    });
    ids?.push(record.sourceRecordId);
    read += 1;
    if (incremental !== undefined) {
      mark = laterStamp(incremental.format, mark, record.incrementalAt);
    }
    // Coalesced by the journal: a line per record would be the run written twice.
    journal.progress("records_read", { entity: entity.name, read });
    if (deps.stop?.aborted === true) {
      stopped = true;
      break;
    }
  }
  const landed = await sink.close();

  // The ledger entry first, the cursor second. What landed is EVIDENCE, and a cursor write that
  // failed would otherwise take an entity's whole record of itself down with it -- the run would
  // settle saying nothing about records that are in the lake and in `raw.records`. The same
  // ordering, and the same reason, as `landing.ts` writing a chunk's refusals before projecting
  // it. A cursor left behind costs one re-read; evidence never written cannot be recovered.
  recordEntity(run, entity.name, landed);

  if (stopped) {
    throw new RunStopped();
  }
  if (incremental !== undefined && mark !== null) {
    await writeSyncCursor(deps.exec, stream, {
      watermark: mark,
      format: incremental.format,
      requestKey,
    });
  }
}

/**
 * The entities some `batch-from` relation actually reads against.
 *
 * Computed from the spec before the first request, so an entity nobody references never
 * builds an id list at all. Keeping every entity's ids to the end of the run was a second
 * copy of the source held for the benefit of a relation that, in both shipped specs,
 * references one entity out of four -- and it grew with the source, which is the shape this
 * whole change exists to remove.
 */
function referencedEntities(reads: readonly EntityRead[]): ReadonlySet<string> {
  return new Set(
    reads.flatMap(({ entity }) =>
      entity.request.kind === "batch-from" ? [entity.request.entity] : [],
    ),
  );
}

export async function runSpecIngest(
  deps: RunDeps,
  input: { source: string; tenantId: string; runId: string },
  ledger: Ledger,
  journal: RunJournal,
): Promise<void> {
  const { spec, ctx, reads } = await openSpecRun(deps, input);
  const run: EntityRun = { deps, input, spec, ledger, journal };

  const referenced = referencedEntities(reads);
  // Ids per entity, so a `batch-from` relation can read against the entity it references --
  // and ONLY for the entities one does.
  const idsByEntity = new Map<string, string[]>();

  for (const read of reads) {
    const { entity } = read;
    // Before an entity rather than only inside one, so a stop that arrived while the last
    // entity's sink was closing does not open the next and read its first page for nothing.
    if (deps.stop?.aborted === true) {
      throw new RunStopped();
    }
    const entityCtx: RunContext =
      entity.request.kind === "batch-from"
        ? { ...ctx, sourceIds: idsByEntity.get(entity.request.entity) ?? [] }
        : ctx;
    const ids = referenced.has(entity.name) ? [] : null;
    if (ids !== null) {
      idsByEntity.set(entity.name, ids);
    }
    await ingestEntity(run, read, entityCtx, ids);
  }
}

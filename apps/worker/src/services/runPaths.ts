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

import {
  EntityNotGranted,
  laterStamp,
  type ReadEnd,
  readEntity,
  type RunContext,
  requestKey,
} from "@undercroft/connector-runtime";
import { type ConnectorEntity, type ConnectorSpec, sourceKind } from "@undercroft/contracts";
import { createByteFetcher } from "@undercroft/core";

import { readSyncCursor, writeSyncCursor } from "../repos/syncCursor.ts";
import { createGoogleApi, googleMinIntervalMs } from "./google/api.ts";
import { type CollectResult, runGoogleCollect } from "./google/collect.ts";
import type { LandSummary, RefusalWriter } from "./landing.ts";
import { NotGranted } from "./notGranted.ts";
import { createRecordSink } from "./recordSink.ts";
import { parentOf, RelationIds } from "./relationIds.ts";
import { settleRemovals } from "./removals.ts";
import type { Ledger, RunDeps } from "./runTypes.ts";
import { resolveToken, RunStopped } from "./runTypes.ts";
import type { RunJournal } from "./runJournal.ts";
import { openSpecRun } from "./specRun.ts";

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
      created: entity.created,
      changed: entity.changed,
      unchanged: entity.unchanged,
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
      created: result.records.created,
      changed: result.records.changed,
      unchanged: result.records.unchanged,
      refused: records,
    },
    {
      entity: "documents",
      landed: result.documents.created + result.documents.unchanged,
      created: result.documents.created,
      changed: 0,
      unchanged: result.documents.unchanged,
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
  const counts = { entity, ...landed };
  run.ledger.entities.push(counts);
  run.journal.info("entity_done", counts);
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

/** Where {@link keepingEnd} puts what a generator returned. Empty until it has returned. */
interface Ended<R> {
  value?: R;
}

/**
 * The same generator, with what it RETURNS put in `end` -- which `for await` would throw away.
 *
 * Only a generator that runs to the end returns anything. One that throws never does, and a
 * `break` out of the loop closes this wrapper and, through `yield*`, the generator inside it,
 * so `end` stays empty. That is what makes `end` safe to decide from: `readEntity` returns the
 * listing of the whole source, and a read that did not finish must not be taken as one.
 */
async function* keepingEnd<T, R>(
  generator: AsyncGenerator<T, R>,
  end: Ended<R>,
): AsyncGenerator<T> {
  end.value = yield* generator;
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
 * It answers every id the read NAMED when `ctx.keepIds` asked for them -- the caller asks for
 * an entity some `batch-from` relation reads against ({@link referencedEntities}) -- and `null`
 * otherwise. Named rather than landed: a record the client filter skipped as unchanged still has
 * links, and a relation handed only the landed ids would learn nothing of them. That was harmless
 * while the only relation had been read since its deals were; a relation added to the spec later
 * would never learn the links of any record that has not changed since (ADR 0075).
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
 *
 * ## And a removal is decided after that, by the same rule
 *
 * An entity whose spec says what an absence means (`removedWhen`) gets back, from a read that
 * listed the whole source, every id it listed -- and its held records outside that set are
 * marked removed at source. It is the one decision here worse to get wrong than the watermark:
 * a partial listing would report every record it had not reached as deleted. So it rides on the
 * generator's return value, which a read that threw or stopped never produces, and sits below
 * the cursor write for the reason the cursor sits below the ledger. From an empty `end`,
 * `settleRemovals` decides nothing. ADR 0071.
 */
async function ingestEntity(
  run: EntityRun,
  entity: ConnectorEntity,
  ctx: RunContext,
): Promise<ReadonlySet<string> | null> {
  const { deps, input, spec, journal } = run;
  journal.info("entity_started", { entity: entity.name });

  const stream = { source: input.source, tenantId: input.tenantId, entity: entity.name };
  const { incremental } = entity;
  // The mark is read, and written back, only under the request this run sends: a request that has
  // changed since -- a spec edit or a scope -- finds none and reads everything once (ADR 0072).
  const reading =
    incremental === undefined
      ? null
      : { format: incremental.format, requestKey: requestKey(spec, entity) };
  const since = reading === null ? null : await readSyncCursor(deps.exec, stream, reading);

  const sink = createRecordSink(
    { lake: deps.lake, exec: deps.exec, refuse: intoLedger(run.ledger) },
    { source: input.source, tenantId: input.tenantId, runId: input.runId },
  );
  const entityCtx: RunContext = { ...ctx, ...(since === null ? {} : { since }) };

  let read = 0;
  let mark: string | null = null;
  let stopped = false;
  const end: Ended<ReadEnd> = {};
  for await (const record of keepingEnd(readEntity(spec, entity, entityCtx), end)) {
    await sink.add({
      entity: record.entity,
      sourceRecordId: record.sourceRecordId,
      sourceUpdatedAt: record.sourceUpdatedAt,
      payloadText: record.payloadText,
    });
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
  if (reading !== null && mark !== null) {
    await writeSyncCursor(deps.exec, stream, { ...reading, watermark: mark });
  }
  await settleRemovals(deps.exec, spec, stream, end.value);
  return end.value?.named ?? null;
}

/**
 * Read one entity, or name it as not granted when its source refuses the token on the first
 * request. `true` when it was read.
 *
 * Only the source's own "this token may not read this list" is caught (`EntityNotGranted`,
 * ADR 0075). Every other failure -- a 403 of any other kind included -- fails the run as it
 * always did.
 */
async function readOrName(
  run: EntityRun,
  entity: ConnectorEntity,
  ctx: RunContext,
  seams: { readonly relations: RelationIds; readonly notGranted: NotGranted },
): Promise<boolean> {
  try {
    seams.relations.keep(entity.name, await ingestEntity(run, entity, ctx));
    return true;
  } catch (error) {
    if (!(error instanceof EntityNotGranted)) {
      throw error;
    }
    seams.notGranted.record(entity.name, error.scopes.join(", "));
    return false;
  }
}

export async function runSpecIngest(
  deps: RunDeps,
  input: { source: string; tenantId: string; runId: string },
  ledger: Ledger,
  journal: RunJournal,
): Promise<void> {
  const { spec, ctx, entities, ungranted } = await openSpecRun(deps, input);
  const run: EntityRun = { deps, input, spec, ledger, journal };
  const notGranted = new NotGranted(journal, ungranted);
  const relations = new RelationIds(entities);
  let read = 0;

  for (const entity of entities) {
    // Before an entity rather than only inside one, so a stop that arrived while the last
    // entity's sink was closing does not open the next and read its first page for nothing.
    if (deps.stop?.aborted === true) {
      throw new RunStopped();
    }
    // A relation hangs off records its parent could not read. Asked with no ids it would land
    // nothing and close as a relation the source answered empty, so it is named with its
    // parent's scope instead: granting that is what would let it be read.
    const parent = parentOf(entity);
    const parentScope = parent === null ? undefined : notGranted.scopeOf(parent);
    if (parentScope === undefined) {
      const readIt = await readOrName(run, entity, relations.contextFor(entity, ctx), {
        relations,
        notGranted,
      });
      read += readIt ? 1 : 0;
    } else {
      notGranted.record(entity.name, parentScope);
    }
  }
  notGranted.refuseWhenNothingRead(input, read);
}

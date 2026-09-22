/**
 * The record half of a sink: lake, then ledger, then projection, then the harvest mark.
 *
 * `landing.ts` holds the contract and the reasoning -- why a chunk is the only thing held, why
 * the projection runs per chunk, and why a record must not outrun its documents. What is only
 * true HERE is the order of the four writes inside one flush, which is load-bearing twice over:
 *
 * - the refusals go down BEFORE the projection, because the projection is the part that can
 *   fail on something other than this chunk, and a run that dies must still have said what it
 *   refused;
 * - the mark goes down AFTER the projection, because until then there is no row to mark.
 *
 * Dying between any two of them costs a re-read of one chunk and never a wrongly-skipped
 * record, which is the direction this whole area is built to fail in.
 */

import type { RunRefusal } from "@undercroft/db/repos";

import { type HarvestMark, markHarvested } from "../repos/rawRecords.ts";
import { type LandedRecord, landRecords } from "./land.ts";
import {
  CHUNK,
  type HarvestedRecord,
  type Landing,
  type LoadedCounts,
  type LandSummary,
  type RecordSink,
  SinkClosed,
  type SinkDeps,
} from "./landing.ts";
import { loadStreamToRaw } from "./loadToRaw.ts";

/**
 * What one landed chunk refused, with why.
 *
 * A record that could not be keyed is the ordinary case, and it is a statement about the
 * data rather than about the run, so it is recorded and the chunk beside it still lands.
 */
function refusalsIn(results: readonly LandedRecord[]): RunRefusal[] {
  return results.flatMap((landed) =>
    landed.status === "failed"
      ? [
          {
            entity: landed.entity,
            sourceRecordId: landed.sourceRecordId,
            reason: landed.reason ?? "refused",
          },
        ]
      : [],
  );
}

/**
 * What of one landed chunk may be marked harvest-complete, for one entity.
 *
 * Two filters, and each is a way to claim completeness falsely. A record that did NOT reach
 * the lake is left out because an old row for the same id may still be sitting in
 * `raw.records` from an earlier run, and marking that would say this run finished a message
 * it refused. A record carrying no count is left out because its caller has no documents to
 * settle, and a mark it never asked for is the inferred completeness this column replaced.
 */
function marksIn(
  chunkOf: readonly HarvestedRecord[],
  results: readonly LandedRecord[],
  entity: string,
): HarvestMark[] {
  const reached = new Set(
    results.flatMap((landed) =>
      landed.entity === entity && landed.status !== "failed" ? [landed.sourceRecordId] : [],
    ),
  );
  return chunkOf.flatMap((record) =>
    record.entity === entity &&
    record.documentsLanded !== undefined &&
    reached.has(record.sourceRecordId)
      ? [{ sourceRecordId: record.sourceRecordId, documentsLanded: record.documentsLanded }]
      : [],
  );
}

/** What one chunk did, in the four numbers a sink accumulates. */
interface ChunkOutcome {
  readonly created: number;
  readonly unchanged: number;
  readonly refused: number;
  readonly loaded: LoadedCounts;
}

/**
 * Put one chunk through all four writes, in the order the module docstring argues for.
 *
 * A function rather than a closure so the order is readable as a list of four statements
 * instead of being braided through the sink's counters, and so the sink itself is only the
 * buffering. It takes no state and keeps none: everything it did comes back as numbers.
 */
async function landChunk(
  deps: SinkDeps,
  at: Landing,
  chunkOf: readonly HarvestedRecord[],
): Promise<ChunkOutcome> {
  const result = await landRecords(deps.lake, {
    source: at.source,
    tenantId: at.tenantId,
    runId: at.runId,
    records: chunkOf,
  });

  await deps.refuse(refusalsIn(result.results));

  // A stream per entity present, since an entity is a property of a record rather than of the
  // sink -- ordinarily one.
  const loaded = { created: 0, changed: 0, unchanged: 0 };
  for (const entity of new Set(chunkOf.map((record) => record.entity))) {
    const identity = { source: at.source, tenantId: at.tenantId, entity };
    const projected = await loadStreamToRaw(deps.exec, deps.lake, identity);
    loaded.created += projected.created;
    loaded.changed += projected.changed;
    loaded.unchanged += projected.unchanged;

    // AFTER the projection, which is what puts the row there to mark -- and after rather than
    // inside it, because this is the one thing about a record that the lake cannot carry:
    // re-landing an unchanged record writes no new version, so there is no journal entry for
    // the projection to read and a fact arriving by that route would never reach a row whose
    // bytes had not moved. `230_documents_landed.sql` argues it in full, and the legacy rows
    // this repairs are exactly the ones whose bytes will not move.
    await markHarvested(deps.exec, identity, marksIn(chunkOf, result.results, entity));
  }

  return { created: result.created, unchanged: result.unchanged, refused: result.failed, loaded };
}

export function createRecordSink(deps: SinkDeps, at: Landing, chunk: number = CHUNK): RecordSink {
  const buffer: HarvestedRecord[] = [];
  const loaded = { created: 0, changed: 0, unchanged: 0 };
  let created = 0;
  let unchanged = 0;
  let refused = 0;
  let closed = false;

  async function flush(): Promise<void> {
    if (buffer.length === 0) {
      return;
    }
    // `splice` empties the buffer as it hands the chunk over, so the sink is already back to
    // holding nothing while this chunk is being landed.
    const outcome = await landChunk(deps, at, buffer.splice(0));
    created += outcome.created;
    unchanged += outcome.unchanged;
    refused += outcome.refused;
    loaded.created += outcome.loaded.created;
    loaded.changed += outcome.loaded.changed;
    loaded.unchanged += outcome.loaded.unchanged;
  }

  return {
    async add(record): Promise<void> {
      if (closed) {
        throw new SinkClosed();
      }
      buffer.push(record);
      if (buffer.length >= chunk) {
        await flush();
      }
    },
    async close(): Promise<LandSummary> {
      await flush();
      closed = true;
      return { landed: created + unchanged, created, unchanged, refused, loaded: { ...loaded } };
    },
  };
}

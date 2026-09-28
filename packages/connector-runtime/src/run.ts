/**
 * Turn a connector spec into a stream of raw records.
 *
 * The whole variable content of a hand-written connector -- how to page, where the records
 * are, what the id path is, how fast to go -- comes from the spec. This file is the fixed
 * machinery around it: pace, fetch, retry, paginate, extract, guard.
 *
 * Two invariants the spec does not state, because they are properties of the runtime
 * rather than of any one source:
 *
 * - **Any failure raises**, never an empty stream, and the message carries how many
 *   records were seen first: "failed after 412 records" is a transient upstream fault,
 *   "failed after 0" is a credential or permission problem, and they want different
 *   responses.
 * - **The payload is preserved losslessly.** Each record's text is produced by
 *   canonicalising its lossless-parsed form, so numbers keep every digit and the same
 *   record always hashes to the same bytes even if the API reorders its keys.
 */

import type { ConnectorEntity, ConnectorSpec } from "@undercroft/contracts";
import { checkGuards } from "./guards.ts";
import { finishListing } from "./listing.ts";
import { type RawRecordOut, type Reader, type RunContext, createReader } from "./reader.ts";
import { readBatch, readPages } from "./reads.ts";

export type { RawRecordOut, RunContext } from "./reader.ts";

/** Dispatch on the one thing that changes the shape of a read: how the request is made. */
async function* readRequest(
  reader: Reader,
  ctx: RunContext,
): AsyncGenerator<RawRecordOut, boolean> {
  const { request } = reader.entity;
  return request.kind === "batch-from"
    ? yield* readBatch(reader, request, ctx.sourceIds ?? [])
    : yield* readPages(reader, request);
}

/**
 * What a read that got to the end can say about the source as a whole.
 *
 * The generator's RETURN value rather than a field on anything the caller holds, so it exists
 * only for a read that finished: one that threw, or that its caller stopped iterating, never
 * produces one, and there is no flag to forget to check.
 */
export interface ReadEnd {
  /**
   * Every id the source listed, when this read listed all of it and the entity says what an
   * absence means (`removedWhen: absent`); `null` whenever it cannot say -- `listing.ts`.
   */
  readonly listed: ReadonlySet<string> | null;
}

/**
 * Read every record for one entity. Async generator, so the caller lands records as they
 * arrive rather than buffering an entire source in memory.
 */
export async function* readEntity(
  spec: ConnectorSpec,
  entity: ConnectorEntity,
  ctx: RunContext,
): AsyncGenerator<RawRecordOut, ReadEnd> {
  const reader = await createReader(spec, entity, ctx);
  const stopped = yield* readRequest(reader, ctx);
  if (stopped) {
    // `maxRecords` truncated the read on purpose, so the end-of-entity guards -- which
    // exist to catch truncation -- have nothing to say about it. Nor has the listing: a
    // truncated read did not name everything.
    return { listed: null };
  }
  checkGuards(reader);
  return { listed: finishListing(reader.listed) };
}

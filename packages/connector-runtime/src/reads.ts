/**
 * The read loops: one per request shape a spec can describe.
 *
 * Split from `reader.ts`, which holds what a read is made of -- pace, fetch, retry, extract,
 * key -- while this holds how each shape drives it: `readPages` a page at a time until the source
 * says there is no next one, `readBatch` a relation's ids in chunks. A list with a `batchRead`
 * step is still `readPages`: it pages the same way, and only what it does with each page
 * differs -- the page names the records and a batch read fetches them (`batchRead.ts`, ADR 0054).
 *
 * Each returns `true` when a guard stopped it mid-stream, because `maxRecords` must NOT then run
 * the end-of-entity guards -- `failOnExactCount` fires on a truncated read, and truncating is
 * exactly what `maxRecords` just did. `yield*` carries that value out, so the caller cannot
 * forget to ask.
 */

import type { ConnectorEntity } from "@undercroft/contracts";
import { rereadPage } from "./batchRead.ts";
import { sinceCarriedIn } from "./incremental.ts";
import { buildUrl, emit, extractRecords, full, type RawRecordOut, type Reader } from "./reader.ts";
import { nextPageUrl, renderBatchBody } from "./paging.ts";

type BatchRequest = Extract<ConnectorEntity["request"], { kind: "batch-from" }>;
type PagedRequest = Exclude<ConnectorEntity["request"], { kind: "batch-from" }>;

/**
 * A relation read: ids harvested from another entity, POSTed in chunks.
 *
 * This exists because a relation like HubSpot's deal->company associations is a different
 * route with a different shape, and bending it into the object reader is how a connector
 * becomes hundreds of lines of special cases.
 */
export async function* readBatch(
  reader: Reader,
  request: BatchRequest,
  ids: readonly string[],
): AsyncGenerator<RawRecordOut, boolean> {
  const url = buildUrl(reader.spec.baseUrl, request.path, {});

  for (let offset = 0; offset < ids.length; offset += request.chunkSize) {
    const chunk = ids.slice(offset, offset + request.chunkSize);
    const parsed = await reader.fetchJson({
      url,
      method: "POST",
      headers: { ...reader.headers, "content-type": "application/json" },
      body: renderBatchBody(request.bodyTemplate, chunk),
    });
    if (yield* emitPage(reader, parsed)) {
      return true;
    }
  }
  return false;
}

/** One page's records as the page carries them. `true` when `maxRecords` stopped it. */
function* emitPage(reader: Reader, parsed: unknown): Generator<RawRecordOut, boolean> {
  for (const record of emit(reader, parsed)) {
    yield record;
    if (full(reader)) {
      return true;
    }
  }
  return false;
}

/** The ordinary read: one page at a time until the source says there is no next one. */
export async function* readPages(
  reader: Reader,
  request: PagedRequest,
): AsyncGenerator<RawRecordOut, boolean> {
  const { spec, entity } = reader;
  let url = buildUrl(spec.baseUrl, request.path, {
    ...request.query,
    ...sinceCarriedIn("query-param", entity, reader.since),
  });
  let pageIndex = 0;

  for (;;) {
    const currentUrl = url;
    const parsed = await reader.fetchJson({ url, method: request.method, headers: reader.headers });

    // Reading the page advances `seen`, so capture the page size before draining it.
    const pageSize = extractRecords(entity, spec, parsed).length;
    const stopped =
      request.batchRead === undefined
        ? yield* emitPage(reader, parsed)
        : yield* rereadPage(reader, request.batchRead, parsed);
    if (stopped) {
      return true;
    }

    const next = nextPageUrl({
      entity,
      spec,
      parsed,
      pageIndex,
      recordsThisPage: pageSize,
      currentUrl,
    });
    pageIndex += 1;
    if (next === null) {
      return false;
    }
    url = next;
  }
}

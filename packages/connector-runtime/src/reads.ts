/**
 * The read loops: one per request shape a spec can describe.
 *
 * Split from `reader.ts`, which holds what a read is made of -- pace, fetch, retry, extract,
 * key -- while this holds how each shape drives it: `readPages` a page at a time until the source
 * says there is no next one, `readBatch` a relation's ids in chunks. A list with a `batchRead`
 * step is still `readPages`: it pages the same way, and only what it does with each page
 * differs -- the page names the records and a batch read fetches them (`batchRead.ts`, ADR 0054).
 *
 * Each returns `true` when it stopped mid-stream -- `maxRecords` reached, or the request budget
 * refused the next page -- because a truncated read must NOT then run the end-of-entity guards:
 * `failOnExactCount` fires on a truncated read, and `failOnEmpty` on a whole read the budget
 * stopped before its first page. `yield*` carries that value out, so the caller cannot forget to
 * ask.
 */

import type { ConnectorEntity } from "@undercroft/contracts";
import { ConnectorError } from "@undercroft/core";
import { rereadPage } from "./batchRead.ts";
import { sinceCarriedIn } from "./incremental.ts";
import {
  buildUrl,
  emit,
  extractRecords,
  full,
  keyOf,
  type RawRecordOut,
  type Reader,
} from "./reader.ts";
import {
  firstPageQuery,
  joinRecordPages,
  nextPageUrl,
  recordPageAfter,
  renderBatchBody,
  renderRecordPageBody,
} from "./paging.ts";

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
  function post(body: string): Promise<unknown> {
    return reader.fetchJson({
      url,
      method: "POST",
      headers: { ...reader.headers, "content-type": "application/json" },
      body,
    });
  }

  for (let offset = 0; offset < ids.length; offset += request.chunkSize) {
    if (!reader.admit()) {
      return true;
    }
    const chunk = ids.slice(offset, offset + request.chunkSize);
    const parsed = await post(renderBatchBody(request.bodyTemplate, chunk));
    const records: unknown[] = [];
    for (const record of extractRecords(reader.entity, reader.spec, parsed)) {
      records.push(await wholeRecord(reader, request, record, post));
    }
    if (yield* emitPage(reader, records)) {
      return true;
    }
  }
  return false;
}

/**
 * One relation record with every page of it, when the source paged it (`recordPageAfter`).
 *
 * Asked for by the record's own id, one page at a time, until the source says there is no more.
 * An answer that does not carry that record, or a cursor that does not move, raises: either
 * would land a record short of links with nothing to say so.
 */
async function wholeRecord(
  reader: Reader,
  request: BatchRequest,
  first: unknown,
  post: (body: string) => Promise<unknown>,
): Promise<unknown> {
  const template = request.bodyTemplate;
  let after = recordPageAfter(template, first);
  if (after === null) {
    return first;
  }
  const { spec, entity } = reader;
  const id = keyOf(reader, first);
  const rest: unknown[] = [];
  while (after !== null) {
    const parsed = await post(renderRecordPageBody(template, id, after));
    const page = extractRecords(entity, spec, parsed).find(
      (record) => keyOf(reader, record) === id,
    );
    if (page === undefined) {
      throw new ConnectorError(
        spec.id,
        entity.name,
        reader.seen,
        `asked for the next page of ${JSON.stringify(id)}'s records and was not answered with it`,
      );
    }
    const next = recordPageAfter(template, page);
    if (next === after) {
      throw new ConnectorError(
        spec.id,
        entity.name,
        reader.seen,
        `the next page of ${JSON.stringify(id)}'s records named the cursor it was asked with`,
      );
    }
    rest.push(page);
    after = next;
  }
  return joinRecordPages(template, first, rest);
}

/** One page's records. `true` when `maxRecords` stopped it. */
function* emitPage(reader: Reader, records: readonly unknown[]): Generator<RawRecordOut, boolean> {
  for (const record of emit(reader, records)) {
    yield record;
    if (full(reader)) {
      return true;
    }
  }
  return false;
}

/**
 * The ordinary read: each partition in turn, one page at a time until the source says there is
 * no next one. An entity with no `partitions` is one partition with nothing laid over its query.
 *
 * One partition to its end before the next, so a partition that fails leaves no later partition
 * read and the entity's listing is never a union with a hole in it (ADR 0075).
 */
export async function* readPages(
  reader: Reader,
  request: PagedRequest,
): AsyncGenerator<RawRecordOut, boolean> {
  for (const partition of request.partitions ?? [{}]) {
    if (yield* readPartition(reader, request, partition)) {
      return true;
    }
  }
  return false;
}

/** One partition's pages. `true` when `maxRecords` or the budget stopped it. */
async function* readPartition(
  reader: Reader,
  request: PagedRequest,
  partition: Readonly<Record<string, string>>,
): AsyncGenerator<RawRecordOut, boolean> {
  const { spec, entity } = reader;
  let url = buildUrl(spec.baseUrl, request.path, {
    ...request.query,
    ...partition,
    ...firstPageQuery(entity, spec),
    ...sinceCarriedIn("query-param", spec, entity, reader.since),
  });
  let pageIndex = 0;

  for (;;) {
    if (!reader.admit()) {
      return true;
    }
    const currentUrl = url;
    const parsed = await reader.fetchJson({ url, method: request.method, headers: reader.headers });

    // Reading the page advances `seen`, so capture the page size before draining it.
    const pageSize = extractRecords(entity, spec, parsed).length;
    const stopped =
      request.batchRead === undefined
        ? yield* emitPage(reader, extractRecords(entity, spec, parsed))
        : yield* rereadPage(reader, request.batchRead, parsed, partition);
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

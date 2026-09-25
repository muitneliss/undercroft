/**
 * A list read in two steps: each page the list answers names which records, and a batch read,
 * asked with their ids in its body, fetches what is landed. ADR 0054.
 *
 * Its own module rather than a branch of `reads.ts`, because the second step is the one place a
 * two-step read can lose a record quietly, and that deserves to be read on its own. `readPages`
 * pages the list exactly as it pages any other and hands each page here.
 *
 * ## The list is still the read of the source
 *
 * The page is what `seen` counts and what the watermark filters, exactly as on a one-step read,
 * so `failOnEmpty`, `failOnExactCount`, `maxRecords` and a client filter mean the same thing
 * either way; the batch read only fetches more of each record the list named. A record the
 * watermark filters out is not asked for at all, which keeps the steady state of an incremental
 * read to one extra request per page that changed.
 *
 * ## Every id asked about is answered, or the read raises
 *
 * A batch read may answer fewer records than it was asked for. HubSpot says why for each one it
 * leaves out: a record deleted or archived between the list naming it and the batch read asking
 * for it comes back as an `OBJECT_NOT_FOUND` error naming its id. That record is not landed, and
 * nothing is lost by it: the list, started a moment later, would not have named it either. It is
 * the one shortfall accepted, because it is the one the source itself explains.
 *
 * Anything else raises (`.claude/rules/connectors.md`): an error of any other category, an id
 * answered by neither a record nor a "not found", a record nobody asked for. Each is a record the
 * lake would otherwise be missing, or holding under the wrong key, with nothing to say so. A run
 * that fails here keeps its watermark and reads the page again next time.
 */

import type { ConnectorEntity } from "@undercroft/contracts";
import { ConnectorError, getPath } from "@undercroft/core";

import { alreadyRead, incrementalAt } from "./incremental.ts";
import { assertNever } from "./paging.ts";
import {
  buildUrl,
  extractRecords,
  full,
  keyOf,
  outOf,
  type RawRecordOut,
  type Reader,
} from "./reader.ts";

type ListRequest = Extract<ConnectorEntity["request"], { kind: "list" }>;

/** A list's second step, as the spec declares it. */
type BatchRead = NonNullable<ListRequest["batchRead"]>;

/** The category HubSpot gives an id it has no live record for. */
const NOT_FOUND = "OBJECT_NOT_FOUND";

/**
 * How many ids one request may carry, per template. HubSpot documents its batch read at 100
 * inputs -- which is also the `limit` its lists page at, so one page is one batch read.
 */
const MAX_IDS: Readonly<Record<BatchRead["bodyTemplate"], number>> = {
  "hubspot-batch-read": 100,
};

/** One page's records as the batch read answers them. `true` when `maxRecords` stopped it. */
export async function* rereadPage(
  reader: Reader,
  batchRead: BatchRead,
  parsed: unknown,
): AsyncGenerator<RawRecordOut, boolean> {
  const { spec, entity, since } = reader;
  const wanted: string[] = [];
  let stopped = false;
  for (const record of extractRecords(entity, spec, parsed)) {
    const id = keyOf(reader, record);
    if (!alreadyRead(entity, since, incrementalAt(entity, record))) {
      wanted.push(id);
    }
    reader.seen += 1;
    if (full(reader)) {
      stopped = true;
      break;
    }
  }

  const url = buildUrl(spec.baseUrl, batchRead.path, {});
  const size = MAX_IDS[batchRead.bodyTemplate];
  for (let offset = 0; offset < wanted.length; offset += size) {
    const asked = wanted.slice(offset, offset + size);
    const answer = await reader.fetchJson({
      url,
      method: "POST",
      headers: { ...reader.headers, "content-type": "application/json" },
      body: bodyOf(batchRead, asked),
    });
    const answered = new Map(
      extractRecords(entity, spec, answer).map((record) => [keyOf(reader, record), record]),
    );
    const problem = unaccounted(batchRead, asked, answered, answer);
    if (problem !== null) {
      throw new ConnectorError(spec.id, entity.name, reader.seen, problem);
    }
    // In the order the list named them, whatever order the batch read answered in.
    for (const id of asked) {
      if (answered.has(id)) {
        yield outOf(reader, id, answered.get(id));
      }
    }
  }
  return stopped;
}

/** The request body that asks for these ids' records. */
function bodyOf(batchRead: BatchRead, ids: readonly string[]): string {
  switch (batchRead.bodyTemplate) {
    case "hubspot-batch-read":
      return JSON.stringify({
        inputs: ids.map((id) => ({ id })),
        properties: batchRead.properties,
      });
    default:
      return assertNever(batchRead.bodyTemplate, "batch read template");
  }
}

/**
 * Why the answer does not account for every id asked about, or `null` when it does: each is
 * answered by a record or by the source's own word that it no longer exists, and nothing else
 * was answered.
 *
 * `answered` is the answer's records by id, keyed by the caller, which already refuses a record
 * with no id; `parsed` is the whole answer, for the errors that ride beside the records.
 */
function unaccounted(
  batchRead: BatchRead,
  asked: readonly string[],
  answered: ReadonlyMap<string, unknown>,
  parsed: unknown,
): string | null {
  const gone = goneIds(batchRead, parsed);
  if (typeof gone === "string") {
    return gone;
  }
  const expected = new Set(asked);
  const unasked = [...answered.keys()].filter((id) => !expected.has(id));
  if (unasked.length > 0) {
    return `the batch read answered ${unasked.length} record(s) it was not asked for, the first ${JSON.stringify(unasked[0])}`;
  }
  const unanswered = asked.filter((id) => !(answered.has(id) || gone.has(id)));
  if (unanswered.length > 0) {
    return `the batch read answered neither a record nor "not found" for ${unanswered.length} of ${asked.length} id(s), the first ${JSON.stringify(unanswered[0])}`;
  }
  return null;
}

/**
 * The ids the answer says have no live record, or -- as a string -- why it refused something
 * else. HubSpot answers a batch read with some ids missing as `207 Multi-Status`, whose body
 * carries `errors[]` beside `results[]`; each not-found error names its ids in `context.ids`.
 */
function goneIds(batchRead: BatchRead, parsed: unknown): ReadonlySet<string> | string {
  switch (batchRead.bodyTemplate) {
    case "hubspot-batch-read": {
      const errors = getPath(parsed, "errors");
      const gone = new Set<string>();
      for (const error of Array.isArray(errors) ? errors : []) {
        const ids = notFoundIds(error);
        if (typeof ids === "string") {
          return ids;
        }
        for (const id of ids) {
          gone.add(id);
        }
      }
      return gone;
    }
    default:
      return assertNever(batchRead.bodyTemplate, "batch read template");
  }
}

/** The ids one HubSpot error says do not exist, or -- as a string -- what else it refused. */
function notFoundIds(error: unknown): readonly string[] | string {
  const category = getPath(error, "category");
  const ids = getPath(error, "context.ids");
  if (category === NOT_FOUND && Array.isArray(ids)) {
    return ids.map(String);
  }
  const message = getPath(error, "message");
  return `the batch read refused part of the page (${String(category)}): ${typeof message === "string" ? message : "no message"}`;
}

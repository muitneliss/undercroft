/**
 * The machinery one entity read is made of: pace, fetch, retry, extract, guard.
 *
 * Split out of `run.ts`, which had grown past what one file may be and held one function
 * doing all six. The split is along the seam that was already there -- a `Reader` is
 * everything a read of one entity needs and holds its running count, and the two request
 * shapes a spec can describe (`batch-from`, and everything else) get one reader each.
 *
 * `readBatch` and `readPages` return `true` when a guard stopped them mid-stream, because
 * `maxRecords` must NOT then run the end-of-entity guards -- `failOnExactCount` fires on a
 * truncated read, and truncating is exactly what `maxRecords` just did. `yield*` carries
 * that value out, so the caller cannot forget to ask.
 *
 * Two concerns that are about a read but not part of one live beside this file rather than in
 * it: `guards.ts` holds what can only be asked once a read is OVER, and `incremental.ts` holds
 * everything about reading only what has changed. A reader carries the watermark it was given
 * and asks that module where to put it.
 */

import type { ConnectorEntity, ConnectorSpec } from "@undercroft/contracts";
import {
  type Clock,
  ConnectorError,
  canonicalJson,
  createPacer,
  getPath,
  getStringPath,
  parseLossless,
  type RetryPolicy,
  systemClock,
  withRetry,
} from "@undercroft/core";
import { type Fetcher, type HttpRequest, raiseForStatus } from "./fetcher.ts";
import { alreadyRead, checkIncremental, incrementalAt, sinceCarriedIn } from "./incremental.ts";
import { nextPageUrl, renderBatchBody } from "./paging.ts";

export interface RawRecordOut {
  readonly source: string;
  readonly entity: string;
  readonly sourceRecordId: string;
  readonly sourceUpdatedAt: string | null;
  readonly payloadText: string;
  /**
   * The value at the entity's `incremental.sourcePath`, verbatim, or `null` when the entity
   * declares no incremental read or this record carries nothing there.
   *
   * Reported rather than accumulated, because the runtime knows how to READ incrementally and
   * the caller knows where a cursor LIVES. It is deliberately not `sourceUpdatedAt`: a
   * shipped spec already proves the two are different fields -- `hubspot.yaml` reads contacts
   * with `updatedAtPath: updatedAt` and `incremental.sourcePath:
   * properties.lastmodifieddate` -- so a watermark derived from one and sent against the
   * other would be a guess about a fact already written down.
   */
  readonly incrementalAt: string | null;
}

export interface RunContext {
  readonly fetcher: Fetcher;
  readonly clock?: Clock;
  /** Resolved late, so a refreshed token is the one the next request carries. */
  readonly token?: () => Promise<string> | string;
  /** The provider's own account id, for a spec whose auth names an account header. */
  readonly accountId?: string;
  /** Injected for deterministic backoff in tests. */
  readonly random?: () => number;
  /**
   * Ids harvested from the entity a `batch-from` request reads against. The orchestrator
   * collects these as it reads the referenced entity and passes them here; an empty list
   * means the relation has nothing to read.
   */
  readonly sourceIds?: readonly string[];
  /**
   * How far this entity was read last time, in the source's own rendering, to be sent back
   * as the entity's `incremental` block says.
   *
   * Absent means a full read, and that is not the same as "incremental is declared": the
   * first run of an entity has no cursor, and it is exactly there that `failOnEmpty` matters
   * most, because a zero from a credential problem and a zero from nothing-new look alike.
   * `guards.ts` keys the relaxation on this value being present, never on the spec.
   */
  readonly since?: string;
}

type Guards = ConnectorSpec["defaults"]["guards"];
type BatchRequest = Extract<ConnectorEntity["request"], { kind: "batch-from" }>;
type PagedRequest = Exclude<ConnectorEntity["request"], { kind: "batch-from" }>;

/**
 * Everything a read of one entity needs, plus the count it is up to.
 *
 * `seen` is mutable and shared on purpose: it is what every `ConnectorError` raised here
 * reports, and "failed after 412" against "failed after 0" is the difference between a
 * transient upstream fault and a credential problem.
 */
export interface Reader {
  readonly spec: ConnectorSpec;
  readonly entity: ConnectorEntity;
  readonly guards: Guards;
  readonly headers: Record<string, string>;
  /** The watermark this read is actually carrying, or `null` for a full read. */
  readonly since: string | null;
  seen: number;
  /** One paced, retried, loss-free fetch. Any failure becomes a ConnectorError with `seen`. */
  readonly fetchJson: (request: HttpRequest) => Promise<unknown>;
}

function retryPolicy(spec: ConnectorSpec): RetryPolicy {
  const r = spec.defaults.retry;
  return {
    attempts: r.attempts,
    on: r.on,
    backoff: r.backoff,
    baseMs: r.baseMs,
    maxMs: r.maxMs,
    jitter: r.jitter,
    respectRetryAfter: r.respectRetryAfter,
    maxRetryAfterMs: r.maxRetryAfterMs,
  };
}

async function authHeaders(spec: ConnectorSpec, ctx: RunContext): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...spec.defaults.headers };
  if (spec.auth.kind === "bearer" || spec.auth.kind === "oauth2") {
    if (ctx.token === undefined) {
      throw new ConnectorError(spec.id, "*", 0, "connector needs a token but none was supplied");
    }
    headers.authorization = `Bearer ${await ctx.token()}`;
  }
  if (spec.auth.kind === "oauth2" && spec.auth.accountHeader !== undefined) {
    // The provider's own org id, resolved from the connection by the caller. Absent is a
    // refusal before the first request: a request without it is a 401 at best and, on a
    // consent that sees several organisations, the wrong org's books at worst.
    if (ctx.accountId === undefined || ctx.accountId === "") {
      throw new ConnectorError(
        spec.id,
        "*",
        0,
        `connector needs the provider's account id for the ${spec.auth.accountHeader} header but none was supplied`,
      );
    }
    headers[spec.auth.accountHeader] = ctx.accountId;
  }
  return headers;
}

/**
 * Join the spec's base URL and an entity's path.
 *
 * The path is made relative before resolving, because `new URL("/Contacts", base)` drops
 * everything after the origin: a base of `https://api.xero.com/api.xro/2.0` became
 * `https://api.xero.com/Contacts`, and the Xero spec had never fetched the right URL.
 * HubSpot's base carries no path, which is why it never showed.
 */
function buildUrl(baseUrl: string, path: string, query: Record<string, string>): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL(path.startsWith("/") ? path.slice(1) : path, base);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function extractRecords(entity: ConnectorEntity, spec: ConnectorSpec, parsed: unknown): unknown[] {
  const container =
    entity.envelopePath === undefined ? parsed : getPath(parsed, entity.envelopePath);
  if (!Array.isArray(container)) {
    throw new ConnectorError(
      spec.id,
      entity.name,
      0,
      entity.envelopePath === undefined
        ? "response body is not an array and no envelopePath was given"
        : `envelopePath ${JSON.stringify(entity.envelopePath)} did not resolve to an array`,
    );
  }
  return container;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Build the reader for one entity: its pacer, its retry policy and its auth headers. */
export async function createReader(
  spec: ConnectorSpec,
  entity: ConnectorEntity,
  ctx: RunContext,
): Promise<Reader> {
  const clock = ctx.clock ?? systemClock;
  const rateLimit = entity.rateLimit ?? spec.defaults.rateLimit;
  const pacer = createPacer(
    {
      minIntervalMs: rateLimit.minIntervalMs,
      ...(rateLimit.requestsPerMinute === undefined
        ? {}
        : { requestsPerMinute: rateLimit.requestsPerMinute }),
      ...(rateLimit.requestsPerDay === undefined
        ? {}
        : { requestsPerDay: rateLimit.requestsPerDay }),
    },
    clock,
  );
  const policy = retryPolicy(spec);
  checkIncremental(spec, entity);

  const since = ctx.since ?? null;

  const reader: Reader = {
    spec,
    entity,
    guards: entity.guards ?? spec.defaults.guards,
    // Xero's `If-Modified-Since` rides beside the auth headers, because from every request's
    // point of view it is just one more header the spec said to send.
    headers: { ...(await authHeaders(spec, ctx)), ...sinceCarriedIn("header", entity, since) },
    since,
    seen: 0,
    fetchJson: async (request: HttpRequest): Promise<unknown> =>
      await withRetry(
        async () => {
          await pacer.acquire();
          const response = await ctx.fetcher.send(request);
          raiseForStatus(request, response);
          return parseLossless(response.text);
        },
        policy,
        { clock, ...(ctx.random === undefined ? {} : { random: ctx.random }) },
      ).catch((error: unknown) => {
        throw new ConnectorError(spec.id, entity.name, reader.seen, describe(error), {
          cause: error,
        });
      }),
  };
  return reader;
}

/** Turn one decoded page into records, refusing any that cannot be keyed. */
function* emit(reader: Reader, parsed: unknown): Generator<RawRecordOut> {
  const { spec, entity, since } = reader;
  for (const record of extractRecords(entity, spec, parsed)) {
    const id = getStringPath(record, entity.idPath);
    if (id === null) {
      // A record with no id cannot be upserted or traced; that is fatal per record.
      throw new ConnectorError(
        spec.id,
        entity.name,
        reader.seen,
        `a record has no value at idPath ${JSON.stringify(entity.idPath)}`,
      );
    }
    const at = incrementalAt(entity, record);
    if (!alreadyRead(entity, since, at)) {
      const updatedAt =
        entity.updatedAtPath === undefined ? null : getStringPath(record, entity.updatedAtPath);
      yield {
        source: spec.id,
        entity: entity.name,
        sourceRecordId: id,
        sourceUpdatedAt: updatedAt,
        payloadText: canonicalJson(record),
        incrementalAt: at,
      };
    }
    // Counted whether it was yielded or filtered, because `seen` is how far through the
    // SOURCE this read got: it is the number `failed after N` reports, and the number
    // `failOnExactCount` measures a page cap against. A client filter changes what is landed,
    // never what the source handed over, so it must not be able to talk a truncated read out
    // of being reported as one.
    reader.seen += 1;
  }
}

/** True once `maxRecords` has been reached, which stops the read where it stands. */
function full(reader: Reader): boolean {
  return reader.guards.maxRecords !== undefined && reader.seen >= reader.guards.maxRecords;
}

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
    for (const record of emit(reader, parsed)) {
      yield record;
      if (full(reader)) {
        return true;
      }
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

    // `emit` advances `seen`, so capture the page size before draining it.
    const pageSize = extractRecords(entity, spec, parsed).length;
    for (const record of emit(reader, parsed)) {
      yield record;
      if (full(reader)) {
        return true;
      }
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

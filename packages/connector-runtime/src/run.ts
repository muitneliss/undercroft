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

// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: Same functions as noExcessiveLinesPerFunction: one sequential procedure each, whose branches are the states the thing being driven can actually be in.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: These are the functions that hold one decision each -- the connector page loop, the deploy poller, the grant migration -- and the way to shorten them is to split one sequential procedure across several names, which makes the order it happens in harder to follow rather than easier.
// biome-ignore-all lint/style/noExcessiveLinesPerFile: One reader, one file: pace, fetch, retry, paginate, extract, guard are one sequential procedure a spec drives from top to bottom, and splitting it by length would put the guards in a different file from the loop they guard.
// biome-ignore-all lint/complexity/useMaxParams: Four functions take five arguments, each a distinct required input with no sensible grouping. Bundling them into an options object to satisfy a count would hide which are required.
// biome-ignore-all lint/nursery/usePlaywrightValidDescribeCallback: Playwright-domain rule. There is no Playwright in this repo.
// biome-ignore-all lint/nursery/useValidTestTitle: The titles this flags are full sentences describing the promise under test -- "is clamped, so a hostile header cannot park a run for hours" -- which is exactly what the repo asks a test title to be. The rule wants a shorter shape.
// biome-ignore-all lint/performance/noAwaitInLoops: These sequential awaits are the point. Pacing a connector against a rate limit, walking Dokploy deployment records until one settles, and migrating SQL files in order all require the previous iteration to finish first; running them concurrently is the bug this rule would introduce.
// biome-ignore-all lint/security/noSecrets: False positives. The rule flags high-entropy string literals, and these are test fixtures with invented values (per .claude/rules/pii.md, fixtures are invented rather than anonymised), plus base64url sample tokens and SQL role names. No real credential is in any tracked file; CI enforces that separately.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useDefaultSwitchClause: Switches over a closed union where the compiler proves exhaustiveness. A default clause would make the next added member compile silently instead of failing here.
// biome-ignore-all lint/style/useDestructuring: Style preference with no correctness content, and it fires where the current form names the source of the value (`params.tenantId`), which is the thing worth seeing at the call site.
// biome-ignore-all lint/style/useExportsLast: Reordering 28 modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. The ordering carries meaning here and the rule's preferred one does not.
// biome-ignore-all lint/suspicious/useAwait: An async function with no await, because the port it implements returns a promise. The contract is the signature, not the body -- `.claude/rules/tests.md` and the ESLint config this replaced both called this out by name.

// biome-ignore-all lint/correctness/useQwikValidLexicalScope: Qwik-domain rule about what may cross a `$()` serialization boundary. There is no Qwik in this repo.

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

export interface RawRecordOut {
  readonly source: string;
  readonly entity: string;
  readonly sourceRecordId: string;
  readonly sourceUpdatedAt: string | null;
  readonly payloadText: string;
}

export interface RunContext {
  readonly fetcher: Fetcher;
  readonly clock?: Clock;
  /** Resolves a bearer token for the connector. Absent for `auth.kind === "none"`. */
  readonly token?: () => Promise<string>;
  /**
   * The provider's own account id, sent in `auth.accountHeader` -- Xero's organisation id
   * in `xero-tenant-id`. Never our tenant id: that is the defect that meant live Xero had
   * never run against the right organisation. Required when the spec names a header.
   */
  readonly accountId?: string;
  /** Injected for deterministic backoff in tests. */
  readonly random?: () => number;
  /**
   * Ids harvested from the entity a `batch-from` request reads against. The orchestrator
   * collects these as it reads the referenced entity and passes them here; an empty list
   * means the relation has nothing to read.
   */
  readonly sourceIds?: readonly string[];
}

/**
 * Render a batch request body from a named template.
 *
 * Named, never arbitrary code: a spec is configuration a user writes, and a template that
 * could execute would make every connector spec a script.
 */
function renderBatchBody(template: "hubspot-batch-inputs", ids: readonly string[]): string {
  switch (template) {
    case "hubspot-batch-inputs":
      return JSON.stringify({ inputs: ids.map((id) => ({ id })) });
  }
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

/** Advance to the next page's URL, or null when the source signals it is done. */
function nextPageUrl(
  entity: ConnectorEntity,
  spec: ConnectorSpec,
  parsed: unknown,
  pageIndex: number,
  recordsThisPage: number,
  currentUrl: string,
): string | null {
  const pagination = entity.pagination ?? spec.defaults.pagination;
  switch (pagination.kind) {
    case "none":
      return null;
    case "json-link": {
      const next = getStringPath(parsed, pagination.nextPath);
      // A next-link equal to the current URL is an infinite loop wearing a cursor.
      if (next === null || next === currentUrl) {
        return null;
      }
      return next;
    }
    case "page-number": {
      if (pagination.stopOn === "empty-page" && recordsThisPage === 0) {
        return null;
      }
      const url = new URL(currentUrl);
      url.searchParams.set(pagination.param, String(pagination.startAt + pageIndex + 1));
      return url.toString();
    }
    case "offset": {
      if (recordsThisPage === 0) {
        return null;
      }
      const url = new URL(currentUrl);
      // parseInt, not Number(): an offset index, not an amount.
      const prev = Number.parseInt(url.searchParams.get(pagination.param) ?? "0", 10);
      url.searchParams.set(pagination.param, String(prev + recordsThisPage));
      return url.toString();
    }
    case "cursor": {
      const cursor = getStringPath(parsed, pagination.cursorPath);
      if (cursor === null) {
        return null;
      }
      const url = new URL(currentUrl);
      url.searchParams.set(pagination.param, cursor);
      return url.toString();
    }
  }
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

/**
 * Read every record for one entity. Async generator, so the caller lands records as they
 * arrive rather than buffering an entire source in memory.
 */
export async function* readEntity(
  spec: ConnectorSpec,
  entity: ConnectorEntity,
  ctx: RunContext,
): AsyncGenerator<RawRecordOut> {
  const clock = ctx.clock ?? systemClock;
  const rateLimit = entity.rateLimit ?? spec.defaults.rateLimit;
  const guards = entity.guards ?? spec.defaults.guards;
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
  const headers = await authHeaders(spec, ctx);
  let seen = 0;

  /** One paced, retried, loss-free fetch. Any failure becomes a ConnectorError with `seen`. */
  async function fetchJson(request: HttpRequest): Promise<unknown> {
    return withRetry(
      async () => {
        await pacer.acquire();
        const response = await ctx.fetcher.send(request);
        raiseForStatus(request, response);
        return parseLossless(response.text);
      },
      policy,
      { clock, ...(ctx.random === undefined ? {} : { random: ctx.random }) },
    ).catch((error: unknown) => {
      throw new ConnectorError(spec.id, entity.name, seen, describe(error), { cause: error });
    });
  }

  /** Turn one decoded page into records, refusing any that cannot be keyed. */
  function* emit(parsed: unknown): Generator<RawRecordOut> {
    for (const record of extractRecords(entity, spec, parsed)) {
      const id = getStringPath(record, entity.idPath);
      if (id === null) {
        // A record with no id cannot be upserted or traced; that is fatal per record.
        throw new ConnectorError(
          spec.id,
          entity.name,
          seen,
          `a record has no value at idPath ${JSON.stringify(entity.idPath)}`,
        );
      }
      const updatedAt =
        entity.updatedAtPath === undefined ? null : getStringPath(record, entity.updatedAtPath);
      yield {
        source: spec.id,
        entity: entity.name,
        sourceRecordId: id,
        sourceUpdatedAt: updatedAt,
        payloadText: canonicalJson(record),
      };
      seen += 1;
    }
  }

  if (entity.request.kind === "batch-from") {
    // A relation read: ids harvested from another entity, POSTed in chunks. This exists
    // because a relation like HubSpot's deal->company associations is a different route
    // with a different shape, and bending it into the object reader is how a connector
    // becomes hundreds of lines of special cases.
    const request = entity.request;
    const ids = ctx.sourceIds ?? [];
    const url = buildUrl(spec.baseUrl, request.path, {});

    for (let offset = 0; offset < ids.length; offset += request.chunkSize) {
      const chunk = ids.slice(offset, offset + request.chunkSize);
      const parsed = await fetchJson({
        url,
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: renderBatchBody(request.bodyTemplate, chunk),
      });
      for (const record of emit(parsed)) {
        yield record;
        if (guards.maxRecords !== undefined && seen >= guards.maxRecords) {
          return;
        }
      }
    }
  } else {
    const request = entity.request;
    let url = buildUrl(spec.baseUrl, request.path, request.query);
    let pageIndex = 0;

    for (;;) {
      const currentUrl = url;
      const parsed = await fetchJson({ url, method: request.method, headers });

      // `emit` advances `seen`, so capture the page size before draining it.
      const pageSize = extractRecords(entity, spec, parsed).length;
      for (const record of emit(parsed)) {
        yield record;
        if (guards.maxRecords !== undefined && seen >= guards.maxRecords) {
          return;
        }
      }

      const next = nextPageUrl(entity, spec, parsed, pageIndex, pageSize, currentUrl);
      pageIndex += 1;
      if (next === null) {
        break;
      }
      url = next;
    }
  }

  // Guards run once the whole entity is read.
  if (guards.failOnEmpty && seen === 0) {
    throw new ConnectorError(spec.id, entity.name, 0, "source returned no records (failOnEmpty)");
  }
  if (guards.failOnExactCount !== undefined && seen === guards.failOnExactCount) {
    // The HubSpot 10,000 cap: landing exactly on it is almost certainly truncation, and
    // the source does not say so.
    throw new ConnectorError(
      spec.id,
      entity.name,
      seen,
      `read exactly ${seen} records, the configured truncation ceiling -- this is probably silent data loss`,
    );
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

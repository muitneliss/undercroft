/**
 * Reading only what has changed: the three strategies, and how two watermarks are ordered.
 *
 * `entity.incremental` has been in the spec schema and in `hubspot.yaml` since the format was
 * written, and no code had ever read it. This is that code, kept in one module rather than
 * threaded through `reader.ts`, because all three strategies answer one question -- *what can
 * I avoid asking for?* -- and only the point at which each one acts differs: a `query-param`
 * before the URL is built, a `header` before the first request, a `client-filter` after a
 * record has been decoded.
 *
 * ## A watermark is stored VERBATIM, and sent verbatim unless the spec says otherwise
 *
 * Stored as the provider rendered it, and compared under the declared `format`. HubSpot's is
 * epoch milliseconds, and is handed back exactly as it arrived: re-rendering it would hand a
 * provider a string it never said, which is a guess wearing the shape of a fact.
 *
 * Xero is the exception that `send: rfc3339-seconds` exists for. It writes `UpdatedDateUTC`
 * as `/Date(1573755038314+0000)/` and reads `If-Modified-Since` as RFC 3339, so the only
 * string it would accept back is one it never wrote. There the instant is rendered, at the
 * moment of sending and rounded down to the second, and the stored text is still Xero's own.
 * ADR 0068, which supersedes the "sent back verbatim" half of ADR 0034.
 *
 * ## A watermark belongs to the request that read it
 *
 * A watermark says how far ONE request's answers were read. Kept across a change to that
 * request, it vouches for records the new request never asked about: Xero's lists were read
 * without `unitdp=4` until #280, and a watermark carried over would leave every invoice not
 * edited since holding the 2-decimal unit prices. So {@link requestKey} names the request, the
 * caller stores the key beside the mark, and a changed request finds no mark and reads
 * everything once. ADR 0071, superseding the "read as declared is `''`" half of ADR 0052.
 *
 * ## Unreadable is never a skip, and never an advance
 *
 * Both answers here fail in the same direction, and it is the direction that cannot lose
 * data. A value that cannot be read in the declared format:
 *
 * - is NOT older than the watermark ({@link alreadyRead} says false), so the record is
 *   landed. Landing one already held costs an `unchanged` row; skipping one not held is a
 *   permanent loss from the one layer that cannot be recomputed.
 * - does NOT become the watermark ({@link laterStamp} ignores it), so a cursor never holds a
 *   string the next run would send and the provider would reject.
 *
 * Together those mean a spec naming the wrong `sourcePath`, or a source that changes its
 * rendering, degrades to the full read this code does today rather than to a quiet gap. Worth
 * stating, because the alternative failure is invisible: an incremental read that silently
 * skipped everything looks exactly like a source with nothing new.
 */

import { createHash } from "node:crypto";
import type { ConnectorEntity, ConnectorSpec } from "@undercroft/contracts";
import {
  ConnectorError,
  canonicalJson,
  getStringPath,
  isoFromMillis,
  msJsonDateMillis,
  parseLossless,
} from "@undercroft/core";

/** An entity's `incremental` block, once the spec has been parsed. */
export type Incremental = NonNullable<ConnectorEntity["incremental"]>;

/** The dialect a source renders its last-modified value in. */
export type IncrementalFormat = Incremental["format"];

/**
 * Which field each strategy carries its watermark in, or `null` for the one that sends none.
 *
 * A table rather than a branch, so a fourth strategy added to the spec schema fails to
 * compile here instead of silently reading the whole source forever.
 */
const CARRIER: Record<Incremental["strategy"], "param" | "header" | null> = {
  "query-param": "param",
  header: "header",
  "client-filter": null,
};

/**
 * One orderable key, or `null` when the text cannot be read in this format.
 *
 * `bigint` rather than `number` for `epoch-millis`, which is the spelling
 * `.claude/rules/money.md` requires anywhere a digit string becomes a value: `Number` and
 * `parseFloat` are banned repo-wide and the money plugin fails the gate on either.
 * `ms-json-date` is the same count inside `/Date(...)/`. The other two formats go through
 * `Date.parse`, whose answer is a whole number of milliseconds, so every format lands on the
 * same scale and one comparison serves them.
 */
function stampKey(format: IncrementalFormat, text: string): bigint | null {
  if (format === "ms-json-date") {
    return msJsonDateMillis(text);
  }
  if (format === "epoch-millis") {
    try {
      return BigInt(text.trim());
    } catch {
      // Anything that is not an integer literal: a fraction, a date, an empty string.
      // `BigInt` refusing it is the answer, not an exception to report.
      return null;
    }
  }
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : BigInt(ms);
}

/**
 * Refuse a spec whose incremental strategy names no field to put the watermark in.
 *
 * Checked on EVERY run rather than only on the ones that have a cursor to send. The defect is
 * in the spec, so it is a fact about the connector from its first read; deferring it to the
 * second run is the same defect discovered in production, against a source that appeared to
 * work. The spec schema cannot express "param is required when strategy is query-param"
 * without a refinement, and `.claude/rules/connectors.md` is clear that a failure raises
 * rather than degrading quietly -- degrading here would ALSO relax `failOnEmpty` while doing
 * a full read, which is the one combination that hides a credential problem.
 */
export function checkIncremental(spec: ConnectorSpec, entity: ConnectorEntity): void {
  const { incremental } = entity;
  if (incremental === undefined) {
    return;
  }
  const carrier = CARRIER[incremental.strategy];
  if (carrier !== null && (incremental[carrier] ?? "") === "") {
    throw new ConnectorError(
      spec.id,
      entity.name,
      0,
      `incremental strategy ${JSON.stringify(incremental.strategy)} needs a ${carrier} to carry the watermark, and the spec names none`,
    );
  }
}

/**
 * Which request a watermark read under this entity belongs to: a digest of what the entity asks
 * the source -- the base URL, the request (method, path, query, body) and the spec's headers.
 *
 * The caller stores it beside the watermark and asks for the watermark back only under the key
 * of the request it is about to send, so ANY change to what is asked -- a spec edit such as
 * `unitdp=4`, or a scope that widens a query -- finds no mark and costs one full read, and an
 * unchanged request keeps its mark. Nobody has to remember to invalidate anything, which is the
 * point: a one-off that forgets marks has to be written again for the next change, by someone
 * who has noticed that it is needed.
 *
 * What is left out does not change what a record is answered AS: pagination, pacing, guards,
 * the envelope and id paths, and the `incremental` block itself (a changed `format` already
 * finds no mark, ADR 0034). So is everything a run resolves per connection -- the token, which
 * rotates, and the account header -- because a key that moved with them would forget every
 * mark on every refresh.
 *
 * The spec is config parsed from YAML, so its numbers (`chunkSize`, a body's `limit`) are
 * already JavaScript numbers, which {@link canonicalJson} refuses on sight because a PAYLOAD's
 * float has lost digits. The round trip through text hands it the same digits the YAML held,
 * as lossless numbers; nothing here is a payload and nothing is landed.
 */
export function requestKey(spec: ConnectorSpec, entity: ConnectorEntity): string {
  const asked = { baseUrl: spec.baseUrl, request: entity.request, headers: spec.defaults.headers };
  const canonical = canonicalJson(parseLossless(JSON.stringify(asked)));
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * What this entity adds to a request to ask the SOURCE for less: a header, or a query
 * parameter, or nothing.
 *
 * One function for both server-side strategies because they differ only in where the same
 * string goes, and `strategy` already says which. Empty whenever there is no watermark yet: a
 * first read sends no header and no parameter at all, rather than one meaning "since the
 * epoch", which a provider is free to read differently from how we meant it.
 *
 * The query parameter is only ever put on the FIRST page's URL. Every later page comes from
 * `nextPageUrl`, which either follows the provider's own link -- whose contents are the
 * provider's business -- or appends a page number to the URL this built, carrying the
 * parameter along with it.
 */
export function sinceCarriedIn(
  kind: "header" | "query-param",
  spec: ConnectorSpec,
  entity: ConnectorEntity,
  since: string | null,
): Record<string, string> {
  const { incremental } = entity;
  if (incremental?.strategy !== kind || since === null) {
    return {};
  }
  const carrier = CARRIER[kind];
  const name = carrier === null ? undefined : incremental[carrier];
  return name === undefined || name === ""
    ? {}
    : { [name]: sent(spec, entity, incremental, since) };
}

const MS_PER_SECOND = 1000n;

/** Toward the past on both sides of the epoch: `%` keeps the sign of a negative count. */
function floorToSecond(ms: bigint): bigint {
  const within = ms % MS_PER_SECOND;
  return within < 0n ? ms - within - MS_PER_SECOND : ms - within;
}

/**
 * The watermark as `send` says to write it.
 *
 * A watermark `rfc3339-seconds` cannot render raises rather than sending nothing. Sending
 * nothing would be a full read, and a run carrying a watermark has `failOnEmpty` relaxed --
 * the combination {@link checkIncremental} refuses, because it hides a credential problem. The
 * cursor only ever holds a value its format could read, so what is left to reach this is a
 * count past the year 275760.
 */
function sent(
  spec: ConnectorSpec,
  entity: ConnectorEntity,
  incremental: Incremental,
  since: string,
): string {
  if (incremental.send === "verbatim") {
    return since;
  }
  const ms = stampKey(incremental.format, since);
  const iso = ms === null ? null : isoFromMillis(floorToSecond(ms));
  if (iso === null) {
    throw new ConnectorError(
      spec.id,
      entity.name,
      0,
      `the watermark ${JSON.stringify(since)} names no instant to send as ${incremental.send}`,
    );
  }
  // `toISOString` always writes `.000` for a whole second; the fraction is dropped, not rounded.
  return `${iso.slice(0, "YYYY-MM-DDTHH:MM:SS".length)}Z`;
}

/** The value at this entity's `incremental.sourcePath`, or null when it declares none. */
export function incrementalAt(entity: ConnectorEntity, record: unknown): string | null {
  const { incremental } = entity;
  return incremental === undefined ? null : getStringPath(record, incremental.sourcePath);
}

/**
 * Has this record already been read, according to the watermark being carried?
 *
 * **A CLIENT FILTER SKIPS; IT NEVER STOPS.** Stopping at the first older record would assume
 * the source orders its pages by the very field being filtered on, and nothing in a REST API
 * promises that -- Xero's `/Invoices?page=N` does not. A read that stopped on an unordered
 * source would leave every newer record behind an older one unread, permanently, because the
 * next run asks only for what is after a watermark those records are already below. So the
 * whole source is paged and only the landing is skipped: no bandwidth is saved, and no lake
 * churn, no `raw.records` churn and no projection cost are paid.
 *
 * Older STRICTLY, so a record rendered at exactly the watermark is landed again. Those records
 * were read by the run that set the watermark -- the source is paged in full, not stopped at a
 * boundary -- so re-landing them is an `unchanged` row and nothing else. The alternative costs
 * a record whenever a source shares one timestamp across several of them.
 */
export function alreadyRead(
  entity: ConnectorEntity,
  since: string | null,
  at: string | null,
): boolean {
  const { incremental } = entity;
  if (incremental?.strategy !== "client-filter" || since === null || at === null) {
    return false;
  }
  const key = stampKey(incremental.format, at);
  const mark = stampKey(incremental.format, since);
  return key !== null && mark !== null && key < mark;
}

/**
 * The later of the watermark held so far and one more value, or whichever one exists.
 *
 * A running maximum rather than "the last record's value", because a source is not obliged to
 * order its pages by the field it is filtered on -- Xero's `/Invoices?page=N` is not -- and a
 * watermark taken from the last record of an unordered read skips everything below it on the
 * next run.
 */
export function laterStamp(
  format: IncrementalFormat,
  held: string | null,
  candidate: string | null,
): string | null {
  const candidateKey = candidate === null ? null : stampKey(format, candidate);
  if (candidate === null || candidateKey === null) {
    return held;
  }
  if (held === null) {
    return candidate;
  }
  const heldKey = stampKey(format, held);
  return heldKey === null || candidateKey > heldKey ? candidate : held;
}

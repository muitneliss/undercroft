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
 * ## A watermark is stored and sent VERBATIM
 *
 * As the provider rendered it. HubSpot's is epoch milliseconds, Xero's `If-Modified-Since` is
 * a datetime. Re-rendering one through a timestamp type hands a provider back a string it
 * never said, which is a guess wearing the shape of a fact -- so the only thing done to these
 * strings is compare two of them, and that needs the declared `format` to know how.
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

import type { ConnectorEntity, ConnectorSpec } from "@undercroft/contracts";
import { ConnectorError, getStringPath } from "@undercroft/core";

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
 * `parseFloat` are banned repo-wide and the money plugin fails the gate on either. The other
 * two formats go through `Date.parse`, whose answer is a whole number of milliseconds, so all
 * three land on the same scale and one comparison serves them.
 */
function stampKey(format: IncrementalFormat, text: string): bigint | null {
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
  entity: ConnectorEntity,
  since: string | null,
): Record<string, string> {
  const { incremental } = entity;
  if (incremental?.strategy !== kind || since === null) {
    return {};
  }
  const carrier = CARRIER[kind];
  const name = carrier === null ? undefined : incremental[carrier];
  return name === undefined || name === "" ? {} : { [name]: since };
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

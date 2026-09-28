/**
 * Where the next page is, and what a request body looks like.
 *
 * Split out of `run.ts`, which had grown past what one file may be. These are the pure
 * decisions in the read loop: what the first page's URL names, given a parsed page what URL
 * comes next, and given a list of ids what body asks for them. All are values in, values out
 * -- no fetching, no clock --
 * which is what lets the five pagination kinds be exercised without a server.
 */

import type { ConnectorEntity, ConnectorSpec } from "@undercroft/contracts";
import { getPath, getStringPath } from "@undercroft/core";

/**
 * The compile-time end of an exhaustive switch.
 *
 * Adding a member to one of these unions -- a new pagination kind, a second batch template --
 * stops compiling HERE rather than falling out of the switch and returning undefined.
 */
export function assertNever(value: never, what: string): never {
  throw new Error(`unhandled ${what}: ${JSON.stringify(value)}`);
}

/**
 * Render a batch request body from a named template.
 *
 * Named, never arbitrary code: a spec is configuration a user writes, and a template that
 * could execute would make every connector spec a script.
 */
type BatchTemplate = "hubspot-batch-inputs";

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function renderBatchBody(template: BatchTemplate, ids: readonly string[]): string {
  switch (template) {
    case "hubspot-batch-inputs":
      return JSON.stringify({ inputs: ids.map((id) => ({ id })) });
    default:
      return assertNever(template, "batch body template");
  }
}

/**
 * The cursor to the rest of ONE relation record, when the source answered only part of it.
 *
 * HubSpot's v4 associations batch read answers a page of each record's links, and puts
 * `paging.next.after` on a record that has more: "the 'after' field in a returned paging object
 * can be added alongside the 'id' to retrieve the next page of associations from that objectId"
 * (its OpenAPI document; the `link` beside it is deprecated). A reader that ignored it would land
 * a quote's first page of line items as if it were all of them.
 */
export function recordPageAfter(template: BatchTemplate, record: unknown): string | null {
  switch (template) {
    case "hubspot-batch-inputs":
      return getStringPath(record, "paging.next.after");
    default:
      return assertNever(template, "batch body template");
  }
}

/** The body that asks for the next page of one record's links. */
export function renderRecordPageBody(template: BatchTemplate, id: string, after: string): string {
  switch (template) {
    case "hubspot-batch-inputs":
      return JSON.stringify({ inputs: [{ id, after }] });
    default:
      return assertNever(template, "batch body template");
  }
}

/**
 * One relation record out of its pages: the first as the source answered it, with every page's
 * links in its `to`, in the order they came, and no `paging` -- the record the source would have
 * answered had it not paged. A record that was never paged is returned as it is, untouched, so
 * its bytes are the bytes it always landed as.
 */
export function joinRecordPages(
  template: BatchTemplate,
  first: unknown,
  rest: readonly unknown[],
): unknown {
  switch (template) {
    case "hubspot-batch-inputs": {
      if (rest.length === 0 || !isRecord(first)) {
        return first;
      }
      const { paging: _paging, ...record } = first;
      const links = [first, ...rest].flatMap((page) => {
        const to = getPath(page, "to");
        return Array.isArray(to) ? to : [];
      });
      return { ...record, to: links };
    }
    default:
      return assertNever(template, "batch body template");
  }
}

export interface PageCursor {
  readonly entity: ConnectorEntity;
  readonly spec: ConnectorSpec;
  readonly parsed: unknown;
  readonly pageIndex: number;
  readonly recordsThisPage: number;
  readonly currentUrl: string;
}

/**
 * What the FIRST page's URL carries for its pagination, before any page has been read.
 *
 * A page-number read names its first page, `startAt`, and {@link nextPageUrl} counts on from
 * it. Leaving it off is not "page one" to every source: Xero answers a list with no `page` with
 * EVERY record, in a summary that drops invoices' and credit notes' line items. The first
 * hundred records then only ever landed in summary, everything after them was read twice, and
 * an incremental read landed the summary over a full record already held (#268).
 */
export function firstPageQuery(
  entity: ConnectorEntity,
  spec: ConnectorSpec,
): Record<string, string> {
  const pagination = entity.pagination ?? spec.defaults.pagination;
  return pagination.kind === "page-number"
    ? { [pagination.param]: String(pagination.startAt) }
    : {};
}

/** Advance to the next page's URL, or null when the source signals it is done. */
export function nextPageUrl(page: PageCursor): string | null {
  const { entity, spec, parsed, pageIndex, recordsThisPage, currentUrl } = page;
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
    default:
      return assertNever(pagination, "pagination kind");
  }
}

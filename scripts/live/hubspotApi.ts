/**
 * Reading HubSpot the way the connector reads it, and nothing but reading.
 *
 * The connector lists each object with `archived=false`, then fetches each page again by batch
 * read with the properties it keeps. These functions ask the same way, for exactly the property
 * names the lake holds, so a difference found later is a difference in the data and not in the
 * question.
 *
 * No credential lives here. The {@link Http} handed in adds the token; the offline suite hands
 * in one that answers only what it was given.
 */

import { arrayAt, type CrmRecord, crmRecord, objectAt, parse, textAt } from "./json.ts";

export interface HttpRequest {
  readonly method: "GET" | "POST";
  /** Path and query under the HubSpot API origin, e.g. `/crm/v3/objects/contacts?limit=100`. */
  readonly path: string;
  readonly body?: string;
}

export interface HttpResponse {
  readonly status: number;
  readonly text: string;
}

export interface Http {
  send: (request: HttpRequest) => Promise<HttpResponse>;
}

/** The objects the HubSpot connector reads. */
export const OBJECTS = ["companies", "contacts", "deals"] as const;
export type CrmObject = (typeof OBJECTS)[number];

/** HubSpot lists 100 records a page and takes at most 100 ids in one batch read. */
const PAGE = 100;

/** The POST endpoints that read. Every other POST is refused before it is sent. */
const READING_POSTS: readonly RegExp[] = [
  /^\/crm\/v3\/objects\/[a-z_]+\/(?:search|batch\/read)(?:\?|$)/u,
  /^\/crm\/v4\/associations\/[a-z_]+\/[a-z_]+\/batch\/read(?:\?|$)/u,
];

export class ReadOnlyRefusal extends Error {
  constructor(request: HttpRequest) {
    super(`refused ${request.method} ${request.path}: this suite only reads HubSpot`);
    this.name = "ReadOnlyRefusal";
  }
}

/**
 * Wrap an {@link Http} so that nothing but a read can leave it. HubSpot reads with GET and with
 * two POSTs, search and batch read; a mistyped path to any other POST would be a write against a
 * real portal, so it fails here instead.
 */
export function readOnly(http: Http): Http {
  return {
    send(request: HttpRequest): Promise<HttpResponse> {
      const reads =
        request.method === "GET" || READING_POSTS.some((pattern) => pattern.test(request.path));
      if (!reads) {
        return Promise.reject(new ReadOnlyRefusal(request));
      }
      return http.send(request);
    },
  };
}

async function answer(http: Http, request: HttpRequest): Promise<Record<string, unknown>> {
  const response = await http.send(request);
  const where = `${request.method} ${request.path}`;
  // 207 is a batch read naming the ids it could not find beside the ones it could.
  if (response.status !== 200 && response.status !== 207) {
    throw new Error(`HubSpot answered ${response.status} to ${where}`);
  }
  return objectAt(parse(response.text, where), where);
}

/** Every live record's id, by paging the list the connector pages. */
export async function listIds(http: Http, object: CrmObject): Promise<string[]> {
  const ids: string[] = [];
  let after: string | null = null;
  do {
    const cursor: string = after === null ? "" : `&after=${encodeURIComponent(after)}`;
    const path: string = `/crm/v3/objects/${object}?limit=${PAGE}&archived=false${cursor}`;
    const page = await answer(http, { method: "GET", path });
    for (const [index, item] of arrayAt(page.results, `${path} results`).entries()) {
      ids.push(textAt(objectAt(item, `${path} #${index}`).id, `${path} #${index}.id`));
    }
    const { next } = objectAt(page.paging ?? {}, `${path} paging`);
    after =
      next === undefined ? null : textAt(objectAt(next, `${path} next`).after, `${path} after`);
  } while (after !== null);
  return ids;
}

/**
 * Those ids' records, with exactly these properties. An id HubSpot reports not found was
 * removed between the list and this read; it comes back in `gone`, not as a record.
 */
export async function batchRead(
  http: Http,
  object: CrmObject,
  ids: readonly string[],
  properties: readonly string[],
): Promise<{ records: Map<string, CrmRecord>; gone: Set<string> }> {
  const records = new Map<string, CrmRecord>();
  const gone = new Set<string>();
  const path = `/crm/v3/objects/${object}/batch/read`;
  for (let start = 0; start < ids.length; start += PAGE) {
    const inputs = ids.slice(start, start + PAGE).map((id) => ({ id }));
    const page = await answer(http, {
      method: "POST",
      path,
      body: JSON.stringify({ inputs, properties }),
    });
    for (const [index, item] of arrayAt(page.results, `${path} results`).entries()) {
      const record = crmRecord(item, `${path} #${index}`);
      records.set(record.id, record);
    }
    for (const error of arrayAt(page.errors ?? [], `${path} errors`)) {
      const failure = objectAt(error, `${path} error`);
      if (failure.category !== "OBJECT_NOT_FOUND") {
        throw new Error(`${path}: HubSpot refused part of a batch: ${String(failure.category)}`);
      }
      const context = objectAt(failure.context ?? {}, `${path} error context`);
      for (const id of arrayAt(context.ids ?? [], `${path} error ids`)) {
        gone.add(textAt(id, `${path} error id`));
      }
    }
  }
  return { records, gone };
}

/** Each deal's linked company ids. A deal HubSpot answers nothing for links to none. */
export async function dealCompanies(
  http: Http,
  dealIds: readonly string[],
): Promise<Map<string, Set<string>>> {
  const links = new Map<string, Set<string>>(dealIds.map((id) => [id, new Set<string>()]));
  const path = "/crm/v4/associations/deals/companies/batch/read";
  for (let start = 0; start < dealIds.length; start += PAGE) {
    const inputs = dealIds.slice(start, start + PAGE).map((id) => ({ id }));
    const page = await answer(http, { method: "POST", path, body: JSON.stringify({ inputs }) });
    for (const [index, item] of arrayAt(page.results, `${path} results`).entries()) {
      const row = objectAt(item, `${path} #${index}`);
      const from = String(objectAt(row.from, `${path} #${index}.from`).id);
      const companies = links.get(from) ?? new Set<string>();
      for (const to of arrayAt(row.to, `${path} #${index}.to`)) {
        companies.add(String(objectAt(to, `${path} #${index}.to`).toObjectId));
      }
      links.set(from, companies);
    }
  }
  return links;
}

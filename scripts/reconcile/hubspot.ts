/**
 * Reading HubSpot, the source, read-only, over the HTTP seam.
 *
 * CLIENT SCOPE FOLLOWS ASSOCIATIONS, NOT NAMES. A client's deals are the objects HubSpot
 * itself associates with the client's company record. Matching on a name would pull in every
 * company that shares a word with it and miss the renamed ones; the association graph is what
 * the CRM users actually maintained.
 *
 * Every listing is paged to its end (`paging.next.after`) and every batch read reports the ids
 * HubSpot did not return, so an archived or merged record shows up as a finding instead of
 * silently shrinking the reference. The only POST is `batch/read`, which reads.
 */

import type { Fetcher } from "../../packages/connector-runtime/src/fetcher.ts";
import { ReconcileError } from "./errors.ts";
import { arrayOrEmpty, asObject, objectOrEmpty, stringOrNull, text } from "./json.ts";
import { type Page, walkPages } from "./paginate.ts";

const API = "https://api.hubapi.com";
const BATCH = 100;
const RUNAWAY_PAGES = 5000;
const MAX_ATTEMPTS = 6;

export type HubSpotObject = "companies" | "contacts" | "deals" | "quotes";

export interface HubSpotRecord {
  readonly id: string;
  readonly archived: boolean;
  readonly updatedAt: string;
  readonly properties: Readonly<Record<string, string | null>>;
}

export interface BatchRead {
  readonly records: readonly HubSpotRecord[];
  /** Ids asked for that HubSpot did not return (archived, merged away, or never existed). */
  readonly notFound: readonly string[];
}

export interface Associations {
  readonly ids: readonly string[];
  readonly exhausted: boolean;
}

export interface Listing {
  readonly records: readonly HubSpotRecord[];
  /** Object id -> associated ids of the requested type, as the list endpoint returned them. */
  readonly associations: ReadonlyMap<string, readonly string[]>;
  readonly exhausted: boolean;
  readonly repeats: number;
}

export interface HubSpotClient {
  /** Every live (non-archived) object of a type, with the named properties. */
  listAll: (
    object: HubSpotObject,
    properties: readonly string[],
    associatedWith?: HubSpotObject,
  ) => Promise<Listing>;
  associations: (from: HubSpotObject, id: string, to: HubSpotObject) => Promise<Associations>;
  batchRead: (
    object: HubSpotObject,
    ids: readonly string[],
    properties: readonly string[],
  ) => Promise<BatchRead>;
}

export class HubSpotApi implements HubSpotClient {
  readonly #fetcher: Fetcher;
  readonly #token: string;

  constructor(fetcher: Fetcher, accessToken: string) {
    this.#fetcher = fetcher;
    this.#token = accessToken;
  }

  async listAll(
    object: HubSpotObject,
    properties: readonly string[],
    associatedWith?: HubSpotObject,
  ): Promise<Listing> {
    const associations = new Map<string, string[]>();
    const walk = await walkPages(
      async (cursor): Promise<Page<HubSpotRecord>> => {
        const body = await this.#send("GET", listPath(object, properties, associatedWith, cursor));
        const items = arrayOrEmpty(body.results).map((item) => {
          const record = parseRecord(item);
          if (associatedWith !== undefined) {
            associations.set(record.id, linkedIds(item, associatedWith));
          }
          return record;
        });
        return { items, next: nextCursor(body) };
      },
      { maxPages: RUNAWAY_PAGES, idOf: (record) => record.id },
    );
    return {
      records: walk.items,
      associations,
      exhausted: walk.exhausted,
      repeats: walk.repeats.size,
    };
  }

  async associations(from: HubSpotObject, id: string, to: HubSpotObject): Promise<Associations> {
    const walk = await walkPages(
      async (cursor): Promise<Page<string>> => {
        const after = cursor === null ? "" : `&after=${encodeURIComponent(cursor)}`;
        const path = `/crm/v4/objects/${from}/${encodeURIComponent(id)}/associations/${to}?limit=500${after}`;
        const body = await this.#send("GET", path);
        return {
          items: arrayOrEmpty(body.results).map((item) => text(asObject(item).toObjectId)),
          next: nextCursor(body),
        };
      },
      { maxPages: RUNAWAY_PAGES, idOf: (value) => value },
    );
    return { ids: [...walk.items].sort(), exhausted: walk.exhausted };
  }

  async batchRead(
    object: HubSpotObject,
    ids: readonly string[],
    properties: readonly string[],
  ): Promise<BatchRead> {
    const unique = [...new Set(ids)];
    const records: HubSpotRecord[] = [];
    for (let start = 0; start < unique.length; start += BATCH) {
      const inputs = unique.slice(start, start + BATCH).map((value) => ({ id: value }));
      const body = await this.#send("POST", `/crm/v3/objects/${object}/batch/read?archived=false`, {
        inputs,
        properties,
      });
      records.push(...arrayOrEmpty(body.results).map(parseRecord));
    }
    const found = new Set(records.map((record) => record.id));
    return { records, notFound: unique.filter((value) => !found.has(value)) };
  }

  async #send(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    const request = {
      url: `${API}${path}`,
      method,
      headers: { authorization: `Bearer ${this.#token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    };
    for (let attempt = 1; ; attempt += 1) {
      const response = await this.#fetcher.send(request);
      if (response.status === 200 || response.status === 207) {
        return asObject(JSON.parse(response.text));
      }
      const retry = response.status === 429 || response.status >= 500;
      if (!retry || attempt >= MAX_ATTEMPTS) {
        throw new ReconcileError(`${method} ${path.split("?")[0] ?? ""} -> ${response.status}`, {
          code: "HUBSPOT",
          status: response.status,
        });
      }
      const after = Number.parseInt(response.headers["retry-after"] ?? "", 10);
      await Bun.sleep(Number.isNaN(after) ? 1000 * 2 ** attempt : after * 1000);
    }
  }
}

export function createHubSpotClient(fetcher: Fetcher, accessToken: string): HubSpotClient {
  return new HubSpotApi(fetcher, accessToken);
}

function listPath(
  object: HubSpotObject,
  properties: readonly string[],
  associatedWith: HubSpotObject | undefined,
  cursor: string | null,
): string {
  const params = new URLSearchParams({ limit: "100", archived: "false" });
  params.set("properties", properties.join(","));
  if (associatedWith !== undefined) {
    params.set("associations", associatedWith);
  }
  if (cursor !== null) {
    params.set("after", cursor);
  }
  return `/crm/v3/objects/${object}?${params}`;
}

function nextCursor(body: Record<string, unknown>): string | null {
  return stringOrNull(objectOrEmpty(objectOrEmpty(body.paging).next).after);
}

/** The ids an inline association group lists, once each (labelled and unlabelled repeat). */
function linkedIds(item: unknown, type: HubSpotObject): string[] {
  const group = objectOrEmpty(objectOrEmpty(asObject(item).associations)[type]);
  const ids = arrayOrEmpty(group.results).map((link) => text(asObject(link).id));
  return [...new Set(ids)].sort();
}

export function parseRecord(item: unknown): HubSpotRecord {
  const row = asObject(item);
  const properties: Record<string, string | null> = {};
  for (const [name, value] of Object.entries(objectOrEmpty(row.properties))) {
    properties[name] = value === null || value === undefined ? null : String(value);
  }
  return {
    id: text(row.id),
    archived: row.archived === true,
    updatedAt: text(row.updatedAt),
    properties,
  };
}

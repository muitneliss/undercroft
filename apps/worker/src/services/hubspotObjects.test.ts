/**
 * The HubSpot objects of issue 279 -- quotes, line items, products, owners, deal pipelines and
 * seven more kinds of link -- read through `runIngest` over the SHIPPED spec. ADR 0075.
 *
 * HubSpot is played by {@link HubSpotPortal}, an in-memory portal that answers the requests the
 * spec sends the way HubSpot's API reference says it does: objects listed by `archived` and paged
 * by `after`, links by the v4 batch read with their `associationTypes`, and a token without an
 * object's scope refused with a 403 whose category is `MISSING_SCOPES`. It refuses any request it
 * does not model, so a spec that asked for something else fails here rather than landing nothing.
 *
 * Every record is invented (`.claude/rules/pii.md`).
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { join } from "node:path";
import type { Fetcher, HttpRequest, HttpResponse } from "@undercroft/connector-runtime";
import { createStampSource, TestClock } from "@undercroft/core";
import { seal } from "@undercroft/crypto";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { InMemoryObjectStore, LakeStore } from "@undercroft/lake";

import { runIngest } from "./ingest.ts";

const TENANT = "CASE-0042";
const KEY = Buffer.alloc(32, 7).toString("base64");
const ENV = { UNDERCROFT_SECRET_KEY: KEY };
const SPECS_DIR = join(import.meta.dirname, "..", "..", "..", "..", "specs", "connectors");
const MODIFIED = "2026-03-01T00:00:00.000Z";
const EARLIER = "2026-01-15T00:00:00.000Z";

/** One CRM record as the portal holds it. */
interface Row {
  readonly id: string;
  readonly archived?: boolean;
  readonly properties?: Readonly<Record<string, string>>;
}

/** One link as HubSpot's v4 batch read answers it, under the record it hangs off. */
interface Link {
  readonly toObjectId: number;
  readonly associationTypes: readonly {
    category: string;
    typeId: number;
    label: string | null;
  }[];
}

interface Portal {
  readonly objects: Readonly<Record<string, readonly Row[]>>;
  readonly owners: readonly Row[];
  readonly pipelines: readonly unknown[];
  /** By `from/to` object type, then by the id of the record the links hang off. */
  readonly links: Readonly<Record<string, Readonly<Record<string, readonly Link[]>>>>;
}

/** The scope HubSpot names when a token lacks an object's. */
const SCOPE_OF: Readonly<Record<string, string>> = {
  quotes: "crm.objects.quotes.read",
  line_items: "crm.objects.line_items.read",
};

const OBJECT_LIST = /^\/crm\/v3\/objects\/(?<type>[a-z_]+)$/u;
const LINK_READ = /^\/crm\/v4\/associations\/(?<from>[a-z_]+)\/(?<to>[a-z_]+)\/batch\/read$/u;

function json(status: number, body: unknown): HttpResponse {
  return { status, headers: {}, text: JSON.stringify(body) };
}

/**
 * HubSpot, in memory. `denied` names the object types this token has no scope for. A list
 * page carries two records whatever `limit` asks for, so every list here is read by `after`.
 */
class HubSpotPortal implements Fetcher {
  readonly calls: HttpRequest[] = [];
  readonly #portal: Portal;
  readonly #denied: ReadonlySet<string>;

  constructor(held: Portal, denied: readonly string[] = []) {
    this.#portal = held;
    this.#denied = new Set(denied);
  }

  send(request: HttpRequest): Promise<HttpResponse> {
    this.calls.push(request);
    const url = new URL(request.url);
    const list = OBJECT_LIST.exec(url.pathname)?.groups?.type;
    const link = LINK_READ.exec(url.pathname)?.groups;
    if (request.method === "GET" && list !== undefined) {
      return Promise.resolve(
        this.#refusal([list]) ?? listPage(url, this.#portal.objects[list] ?? []),
      );
    }
    if (request.method === "GET" && url.pathname === "/crm/v3/owners") {
      return Promise.resolve(listPage(url, this.#portal.owners));
    }
    if (request.method === "GET" && url.pathname === "/crm/v3/pipelines/deals") {
      return Promise.resolve(json(200, { results: this.#portal.pipelines }));
    }
    if (request.method === "POST" && link?.from !== undefined && link.to !== undefined) {
      return Promise.resolve(
        this.#refusal([link.from, link.to]) ??
          linkAnswer(this.#portal.links[`${link.from}/${link.to}`] ?? {}, request.body),
      );
    }
    return Promise.reject(new Error(`HubSpotPortal does not model ${request.method} ${url}`));
  }

  /** The 403 HubSpot answers a token without the scope, or `null` when it has it. */
  #refusal(types: readonly string[]): HttpResponse | null {
    const denied = types.find((type) => this.#denied.has(type));
    return denied === undefined
      ? null
      : json(403, {
          status: "error",
          message: "This app hasn't been granted all required scopes to make this call.",
          category: "MISSING_SCOPES",
          errors: [
            {
              message: "One or more of the following scopes are required.",
              context: { requiredGranularScopes: [SCOPE_OF[denied] ?? denied] },
            },
          ],
        });
  }
}

/** One page of a list, live or archived as asked, paged by `after`. */
function listPage(url: URL, rows: readonly Row[]): HttpResponse {
  const archived = url.searchParams.get("archived") === "true";
  const matching = rows.filter((row) => (row.archived ?? false) === archived);
  const start = Number.parseInt(url.searchParams.get("after") ?? "0", 10);
  const page = matching.slice(start, start + 2);
  const next = start + page.length;
  return json(200, {
    results: page.map((row) => ({
      id: row.id,
      properties: { hs_lastmodifieddate: MODIFIED, ...row.properties },
      createdAt: MODIFIED,
      updatedAt: MODIFIED,
      archived,
    })),
    ...(next < matching.length ? { paging: { next: { after: String(next) } } } : {}),
  });
}

/** The v4 batch read: each asked id's links, or HubSpot's word that it has none. */
function linkAnswer(
  byId: Readonly<Record<string, readonly Link[]>>,
  body: string | undefined,
): HttpResponse {
  const parsed: unknown = JSON.parse(body ?? "{}");
  const inputs =
    typeof parsed === "object" && parsed !== null && "inputs" in parsed ? parsed.inputs : [];
  const ids = (Array.isArray(inputs) ? inputs : []).map((input: { id: string }) => input.id);
  const answered = ids.filter((id) => (byId[id] ?? []).length > 0);
  const none = ids.filter((id) => !answered.includes(id));
  return json(none.length > 0 ? 207 : 200, {
    status: "COMPLETE",
    results: answered.map((id) => ({ from: { id }, to: byId[id] })),
    ...(none.length > 0
      ? {
          numErrors: none.length,
          errors: none.map((id) => ({
            status: "error",
            category: "OBJECT_NOT_FOUND",
            subCategory: "crm.associations.NO_ASSOCIATIONS_FOUND",
            context: { fromObjectId: [id] },
          })),
        }
      : {}),
  });
}

/** A link of one HubSpot-defined kind, with no label. */
function linked(toObjectId: number, typeId: number): Link {
  return { toObjectId, associationTypes: [{ category: "HUBSPOT_DEFINED", typeId, label: null }] };
}

/**
 * A small portal with every case the issue names: a contact at two companies, one of them its
 * primary and the other under the portal's own label; a quote with no deal; a line item with no
 * product and one sold as a product since archived; a deactivated owner; a custom pipeline.
 */
function portal(): Portal {
  return {
    objects: {
      companies: [
        { id: "101", properties: { name: "Acme Trading" } },
        { id: "102", properties: { name: "Example Holdings" } },
      ],
      // 202 last changed before 201 did, so a run after the first holds a watermark above it.
      contacts: [
        { id: "201", properties: { email: "buyer@example.test", lastmodifieddate: MODIFIED } },
        { id: "202", properties: { email: "clerk@example.test", lastmodifieddate: EARLIER } },
      ],
      deals: [{ id: "301", properties: { dealname: "Acme renewal", dealstage: "4815162" } }],
      quotes: [
        { id: "401", properties: { hs_title: "Renewal quote" } },
        { id: "402", properties: { hs_title: "Walk-in quote" } },
      ],
      line_items: [
        { id: "501", properties: { name: "Support plan", hs_product_id: "601" } },
        { id: "502", properties: { name: "Old widget", hs_product_id: "602" } },
        { id: "503", properties: { name: "Custom work" } },
      ],
      products: [
        { id: "601", properties: { name: "Support plan" } },
        { id: "602", archived: true, properties: { name: "Old widget" } },
      ],
    },
    owners: [
      { id: "701", properties: {} },
      { id: "702", archived: true, properties: {} },
    ],
    pipelines: [
      {
        id: "8342",
        label: "Renewals",
        displayOrder: 1,
        archived: false,
        updatedAt: MODIFIED,
        stages: [
          {
            id: "4815162",
            label: "Proposal sent",
            displayOrder: 0,
            metadata: { isClosed: "false", probability: "0.4" },
          },
          {
            id: "4815163",
            label: "Won",
            displayOrder: 1,
            metadata: { isClosed: "true", probability: "1.0" },
          },
        ],
      },
    ],
    links: {
      "deals/companies": { 301: [linked(101, 5)] },
      "contacts/companies": {
        201: [
          {
            toObjectId: 101,
            associationTypes: [
              { category: "HUBSPOT_DEFINED", typeId: 1, label: "Primary" },
              { category: "HUBSPOT_DEFINED", typeId: 279, label: null },
            ],
          },
          {
            toObjectId: 102,
            associationTypes: [
              { category: "HUBSPOT_DEFINED", typeId: 279, label: null },
              { category: "USER_DEFINED", typeId: 28, label: "Billing contact" },
            ],
          },
        ],
        202: [
          {
            toObjectId: 102,
            associationTypes: [{ category: "HUBSPOT_DEFINED", typeId: 1, label: "Primary" }],
          },
        ],
      },
      "deals/contacts": { 301: [linked(201, 3)] },
      "deals/quotes": { 301: [linked(401, 63)] },
      "deals/line_items": { 301: [linked(501, 19)] },
      "quotes/line_items": { 401: [linked(501, 67), linked(502, 67)], 402: [linked(503, 67)] },
      "quotes/contacts": { 401: [linked(201, 69)] },
      "quotes/companies": { 401: [linked(101, 71)] },
    },
  };
}

let db: TestDatabase;
let lake: LakeStore;

beforeEach(async () => {
  lake = new LakeStore(new InMemoryObjectStore(), { stamps: createStampSource(new TestClock()) });
  db = await createMigratedTestDatabase();
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [TENANT]);
  const sealed = seal(JSON.stringify({ accessToken: "pat", refreshToken: "", expiresAt: null }), {
    env: ENV,
  });
  await db.query(
    "INSERT INTO ops.connection (tenant_id, source, status) VALUES ($1, 'hubspot', 'connected')",
    [TENANT],
  );
  await db.query(
    "INSERT INTO app.connection_secret (tenant_id, source, ciphertext, key_version) VALUES ($1, 'hubspot', $2, 1)",
    [TENANT, Buffer.from(sealed.blob)],
  );
  await db.become("undercroft_worker");
});

afterEach(async () => {
  await db.close();
});

function ingest(fetcher: Fetcher): ReturnType<typeof runIngest> {
  return runIngest(
    { lake, exec: db, specsDir: SPECS_DIR, env: ENV, fetcher },
    { source: "hubspot", tenantId: TENANT },
  );
}

/** Every landed record's id, by entity. */
async function landed(): Promise<Record<string, string[]>> {
  const { rows } = await db.query<{ entity: string; id: string }>(
    `SELECT entity, source_record_id AS id FROM raw.records
     WHERE source = 'hubspot' ORDER BY entity, source_record_id`,
  );
  const byEntity: Record<string, string[]> = {};
  for (const row of rows) {
    byEntity[row.entity] = [...(byEntity[row.entity] ?? []), row.id];
  }
  return byEntity;
}

async function payloadOf(entity: string, id: string): Promise<Record<string, unknown>> {
  const { rows } = await db.query<{ payload: Record<string, unknown> }>(
    "SELECT payload FROM raw.records WHERE entity = $1 AND source_record_id = $2",
    [entity, id],
  );
  return rows[0]?.payload ?? {};
}

describe("a HubSpot connection with no scope chosen", () => {
  it("lands quotes, line items, products, owners and pipelines, and every link kind", async () => {
    await ingest(new HubSpotPortal(portal()));

    expect(await landed()).toEqual({
      associations: ["301"],
      companies: ["101", "102"],
      contact_companies: ["201", "202"],
      contacts: ["201", "202"],
      deal_contacts: ["301"],
      deal_line_items: ["301"],
      deal_pipelines: ["8342"],
      deal_quotes: ["301"],
      deals: ["301"],
      line_items: ["501", "502", "503"],
      // Archived and live alike, so line item 502's product resolves.
      owners: ["701", "702"],
      products: ["601", "602"],
      quote_companies: ["401"],
      quote_contacts: ["401"],
      quote_line_items: ["401", "402"],
      quotes: ["401", "402"],
    });
    expect((await payloadOf("products", "602")).archived).toBe(true);
    expect((await payloadOf("owners", "702")).archived).toBe(true);
    expect(await payloadOf("deal_pipelines", "8342")).toMatchObject({
      stages: [
        { id: "4815162", metadata: { isClosed: "false", probability: "0.4" } },
        { id: "4815163", metadata: { isClosed: "true", probability: "1.0" } },
      ],
    });
  });

  it("lands every company a contact is linked to, each with its kind and label", async () => {
    await ingest(new HubSpotPortal(portal()));

    expect(await payloadOf("contact_companies", "201")).toEqual({
      from: { id: "201" },
      to: portal().links["contacts/companies"]?.["201"],
    });
  });

  it("lands a quote with no deal and a line item with no product", async () => {
    // Neither is an error: quote 402 was never on a deal, and line item 503 was typed in by hand.
    await ingest(new HubSpotPortal(portal()));

    const byEntity = await landed();
    expect(byEntity.quotes).toContain("402");
    expect(byEntity.line_items).toContain("503");
    expect(await payloadOf("line_items", "503")).not.toHaveProperty("properties.hs_product_id");
  });

  it("asks every contact for its companies on every run, and a second run changes nothing", async () => {
    // The second run's watermark skips landing contact 202, which has not changed, but its links
    // are still asked for: a link read added after the watermark was set would otherwise never
    // learn the links of any contact that has not changed since.
    await ingest(new HubSpotPortal(portal()));
    const again = new HubSpotPortal(portal());

    const result = await ingest(again);

    expect(result.entities.find((e) => e.entity === "contacts")?.landed).toBe(1);
    const asked = again.calls.find((call) => call.url.includes("/contacts/companies/"));
    expect(JSON.parse(asked?.body ?? "{}")).toEqual({ inputs: [{ id: "201" }, { id: "202" }] });
    expect(result.entities.filter((e) => e.created > 0 || e.changed > 0)).toEqual([]);
  });
});

describe("a HubSpot private app without the quotes scope", () => {
  it("names quotes and its links as not granted, with the scope, and the run still lands the rest", async () => {
    const result = await ingest(new HubSpotPortal(portal(), ["quotes"]));

    const { rows } = await db.query<{ entity: string; scope: string }>(
      `SELECT entity, detail->>'scope' AS scope FROM ops.run_event
       WHERE event = 'entity_not_granted' ORDER BY id`,
    );
    const quotesScope = "crm.objects.quotes.read";
    expect(rows).toEqual(
      ["quotes", "deal_quotes", "quote_line_items", "quote_contacts", "quote_companies"].map(
        (entity) => ({ entity, scope: quotesScope }),
      ),
    );
    // The run closed succeeded -- `runIngest` resolved -- with the four streams read before.
    const read = new Map(result.entities.map((e) => [e.entity, e.landed]));
    expect([read.get("companies"), read.get("contacts"), read.get("deals")]).toEqual([2, 2, 1]);
    expect(read.get("associations")).toBe(1);
    expect(read.has("quotes")).toBe(false);
  });
});

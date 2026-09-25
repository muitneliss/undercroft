/**
 * A HubSpot scope widens what each CRM object read asks for, and never below the spec. Issue 202,
 * ADR 0052; issue 210, ADR 0054 for the widened read's two steps.
 *
 * Driven through `runIngest` over the SHIPPED `specs/connectors/hubspot.yaml` and a recorded
 * fetcher that refuses any request nobody recorded -- so "this is what was asked for" is proved
 * by the only URLs that were answered, and a connection nobody scoped is held to exactly the
 * requests the spec has always sent.
 *
 * Three promises are pinned, each a way a widened read could quietly be wrong:
 * - with no scope, every object is asked for the spec's own properties and nothing else;
 * - a choice is ADDED to the spec's list, so the property a cursor is read from cannot be lost --
 *   and it is asked for in a batch read's body, so the list's URL stays the spec's however much
 *   is chosen;
 * - a changed request does not inherit the old one's watermark, and an unchanged one keeps it.
 *   Without the first half, a property chosen today would reach only the companies that happen
 *   to change after it, and the lake would never say which.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { join } from "node:path";
import { InMemoryFetcher } from "@undercroft/connector-runtime/testing";
import { createStampSource, TestClock } from "@undercroft/core";
import { seal } from "@undercroft/crypto";
import { writeConnectionDetail } from "@undercroft/db/repos";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { InMemoryObjectStore, LakeStore } from "@undercroft/lake";

import { runIngest } from "./ingest.ts";
import { readSpec } from "./specs.ts";

const TENANT = "CASE-1";
const KEY = Buffer.alloc(32, 5).toString("base64");
const ENV = { UNDERCROFT_SECRET_KEY: KEY };
/** The shipped specs, read and never written. */
const SPECS_DIR = join(import.meta.dirname, "..", "..", "..", "..", "specs", "connectors");
const ASSOCIATIONS = "https://api.hubapi.com/crm/v4/associations/deals/companies/batch/read";
const COMPANIES_BATCH = "https://api.hubapi.com/crm/v3/objects/companies/batch/read";

/** The properties the shipped spec reads on one object, as it writes them. */
function specProperties(object: string): string {
  const request = readSpec(SPECS_DIR, "hubspot").entities.find((e) => e.name === object)?.request;
  return request?.kind === "list" ? (request.query.properties ?? "") : "";
}

/** One object's list URL, built the way the runtime builds it. */
function listUrl(object: string, properties: string): string {
  const url = new URL(`https://api.hubapi.com/crm/v3/objects/${object}`);
  url.searchParams.set("limit", "100");
  url.searchParams.set("archived", "false");
  url.searchParams.set("properties", properties);
  return url.toString();
}

/** A company as HubSpot answers it: only the properties it was asked for. */
function company(id: string, modified: string, extra: Record<string, string> = {}): unknown {
  return {
    id,
    updatedAt: modified,
    properties: { name: `Acme ${id}`, hs_lastmodifieddate: modified, ...extra },
  };
}

/**
 * HubSpot as recorded: `companies` listed as the spec declares it, the other two objects and the
 * relation at the URLs the spec has always used. Any other request is refused -- a widened read
 * records its batch read on top with {@link batchAnswers}.
 */
function hubspot(companies: unknown[]): InMemoryFetcher {
  return new InMemoryFetcher()
    .on("GET", listUrl("companies", specProperties("companies")), {
      body: { results: companies, paging: {} },
    })
    .on("GET", listUrl("contacts", specProperties("contacts")), {
      body: {
        results: [{ id: "c1", updatedAt: "2026-01-01T00:00:00.000Z", properties: {} }],
        paging: {},
      },
    })
    .on("GET", listUrl("deals", specProperties("deals")), {
      body: {
        results: [{ id: "d1", updatedAt: "2026-01-01T00:00:00.000Z", properties: {} }],
        paging: {},
      },
    })
    .on("POST", ASSOCIATIONS, { body: { results: [] } });
}

/** HubSpot's batch read of companies, answering these records whatever it is asked. */
function batchAnswers(fetcher: InMemoryFetcher, companies: unknown[]): InMemoryFetcher {
  return fetcher.on("POST", COMPANIES_BATCH, { body: { status: "COMPLETE", results: companies } });
}

/** What each batch read of companies asked for, as sent. */
function batchBodies(
  fetcher: InMemoryFetcher,
): { inputs: { id: string }[]; properties: string[] }[] {
  return fetcher.calls
    .filter((call) => call.url === COMPANIES_BATCH)
    .map(
      (call) => JSON.parse(call.body ?? "{}") as { inputs: { id: string }[]; properties: string[] },
    );
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

/** Record what the admin chose, as `connections.setScope` would have. */
async function choose(properties: Record<string, string[]>): Promise<void> {
  await db.asSuperuser((tx) =>
    writeConnectionDetail(tx, {
      tenantId: TENANT,
      source: "hubspot",
      selectionJson: JSON.stringify({ properties }),
    }),
  );
}

function ingest(fetcher: InMemoryFetcher): ReturnType<typeof runIngest> {
  return runIngest(
    { lake, exec: db, specsDir: SPECS_DIR, env: ENV, fetcher },
    { source: "hubspot", tenantId: TENANT },
  );
}

async function payloadOf(id: string): Promise<{ properties: Record<string, unknown> }> {
  const { rows } = await db.query<{ payload: { properties: Record<string, unknown> } }>(
    "SELECT payload FROM raw.records WHERE entity = 'companies' AND source_record_id = $1",
    [id],
  );
  return rows[0]?.payload ?? { properties: {} };
}

describe("a HubSpot connection nobody has scoped", () => {
  it("asks every object for the spec's own properties, and reads all four entities", async () => {
    const fetcher = hubspot([company("1", "2026-01-01T00:00:00.000Z")]);

    const result = await ingest(fetcher);

    expect(result.entities.map((entity) => entity.entity)).toEqual([
      "companies",
      "contacts",
      "deals",
      "associations",
    ]);
    expect(fetcher.calls.map((call) => call.url)).toEqual([
      listUrl("companies", specProperties("companies")),
      listUrl("contacts", specProperties("contacts")),
      listUrl("deals", specProperties("deals")),
      ASSOCIATIONS,
    ]);
  });
});

describe("a HubSpot scope", () => {
  it("lists as the spec declares, then batch-reads the page for the spec's properties and what was chosen", async () => {
    // `hs_lastmodifieddate` is the cursor's own property: choosing it changes nothing, and not
    // choosing it could not remove it. The list's URL is the spec's, whatever is chosen -- which
    // is why no choice can be too long to send. Contacts and deals, with nothing chosen, are
    // asked exactly what the spec asks -- `hubspot()` records them nowhere else.
    await choose({ companies: ["x_onboarding_stage", "annualrevenue", "hs_lastmodifieddate"] });
    const fetcher = batchAnswers(
      hubspot([company("1", "2026-01-01T00:00:00.000Z"), company("2", "2026-01-02T00:00:00.000Z")]),
      [
        company("2", "2026-01-02T00:00:00.000Z", { annualrevenue: "900" }),
        company("1", "2026-01-01T00:00:00.000Z", { annualrevenue: "1200000" }),
      ],
    );

    const result = await ingest(fetcher);

    expect(fetcher.calls.slice(0, 2).map((call) => call.url)).toEqual([
      listUrl("companies", specProperties("companies")),
      COMPANIES_BATCH,
    ]);
    expect(batchBodies(fetcher)).toEqual([
      {
        inputs: [{ id: "1" }, { id: "2" }],
        properties: [
          ...specProperties("companies").split(","),
          "annualrevenue",
          "x_onboarding_stage",
        ],
      },
    ]);
    expect(result.entities.find((entity) => entity.entity === "companies")?.landed).toBe(2);
    expect((await payloadOf("1")).properties.annualrevenue).toBe("1200000");
  });

  it("a widened read starts from no mark, so a company unchanged since is read with the new property", async () => {
    await ingest(
      hubspot([company("1", "2026-01-01T00:00:00.000Z"), company("2", "2026-02-01T00:00:00.000Z")]),
    );

    // Company 1 is older than the mark the first run left. Under that mark it would be
    // filtered out of the list, never asked of the batch read, and its row would never carry the
    // property chosen now.
    await choose({ companies: ["annualrevenue"] });
    const both = [
      company("1", "2026-01-01T00:00:00.000Z"),
      company("2", "2026-02-01T00:00:00.000Z"),
    ];
    await ingest(
      batchAnswers(hubspot(both), [
        company("1", "2026-01-01T00:00:00.000Z", { annualrevenue: "500" }),
        company("2", "2026-02-01T00:00:00.000Z", { annualrevenue: "900" }),
      ]),
    );

    expect((await payloadOf("1")).properties.annualrevenue).toBe("500");
  });

  it("an unchanged scope keeps its mark: a company unchanged since is not asked for again", async () => {
    // The quiet side of the one above. The request key is a function of the request alone, so
    // saving the same choice again does not throw a watermark away over nothing.
    await choose({ companies: ["annualrevenue"] });
    const listed = [
      company("1", "2026-01-01T00:00:00.000Z"),
      company("2", "2026-02-01T00:00:00.000Z"),
    ];
    const read = [
      company("1", "2026-01-01T00:00:00.000Z", { annualrevenue: "500" }),
      company("2", "2026-02-01T00:00:00.000Z", { annualrevenue: "900" }),
    ];
    await ingest(batchAnswers(hubspot(listed), read));

    const fetcher = batchAnswers(hubspot(listed), [read[1]]);
    const again = await ingest(fetcher);

    // Company 2 sits AT the mark and is read again, as every run reads the mark's own records;
    // company 1 is below it and is not even asked for.
    expect(batchBodies(fetcher).map((body) => body.inputs)).toEqual([[{ id: "2" }]]);
    expect(again.entities.find((entity) => entity.entity === "companies")?.landed).toBe(1);
  });

  it("the truncation guards still hold on a widened read: an empty first read fails", async () => {
    await choose({ companies: ["annualrevenue"] });

    await expect(ingest(hubspot([]))).rejects.toThrow("failOnEmpty");
  });
});

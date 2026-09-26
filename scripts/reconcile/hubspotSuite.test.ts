/**
 * The HubSpot suite end to end, offline, over an invented portal: HubSpot through
 * `InMemoryFetcher`, OSTWIN's mirror in SQLite behind `AskPy`, the lake behind `LakeCli`. Each
 * record is placed to move one case, so a change to how legs, links or duplicates are judged
 * shows up as a case changing status.
 *
 * Every value here is invented (`.claude/rules/pii.md`).
 */
import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

import { InMemoryFetcher } from "../../packages/connector-runtime/src/testing.ts";
import { AskPy } from "./askPyStandIn.ts";
import type { LiveConfig } from "./config.ts";
import { runHubSpotSuite } from "./hubspotSuite.ts";
import { LakeCli, routeCommands } from "./lakeStandIn.ts";
import { MemorySink } from "./memorySink.ts";
import type { TestResult } from "./model.ts";
import { createOstwinReader } from "./ostwin.ts";
import { createUndercroftReader } from "./undercroft.ts";

const API = "https://api.hubapi.com";
const PULLED = "2026-09-10T00:00:00+00:00";
const LAKE_RUN = "2026-09-20T00:00:00.000Z";
const MODIFIED = "2026-09-01T00:00:00.000Z";

const COMPANIES = [
  {
    id: "101",
    properties: { name: "Client Co", domain: "client.example.test", hs_lastmodifieddate: MODIFIED },
  },
  // Missing from the lake although older than its run: S2U MISSING.
  {
    id: "102",
    properties: { name: "Other Co", domain: "other.example.test", hs_lastmodifieddate: MODIFIED },
  },
];
const CONTACTS = [
  {
    id: "201",
    properties: {
      email: "p@client.example.test",
      firstname: "P",
      lastname: "Q",
      lastmodifieddate: MODIFIED,
    },
  },
];
const DEAL = {
  dealname: "Annual",
  amount: "1500",
  dealstage: "won",
  pipeline: "default",
  closedate: "2026-01-31T00:00:00Z",
  hs_lastmodifieddate: MODIFIED,
};
// Two deals recording one event: the duplicate case fails.
const DEALS = [
  { id: "301", properties: DEAL },
  { id: "302", properties: { ...DEAL, amount: "1500.00" } },
];
const QUOTES = [
  {
    id: "401",
    properties: {
      hs_title: "Q",
      hs_status: "APPROVED",
      hs_quote_amount: "1500",
      hs_expiration_date: "2026-02-28",
      hs_currency: "SGD",
      hs_lastmodifieddate: MODIFIED,
    },
  },
];

function listUrl(object: string, properties: readonly string[], associations?: string): string {
  const params = new URLSearchParams({ limit: "100", archived: "false" });
  params.set("properties", properties.join(","));
  if (associations !== undefined) {
    params.set("associations", associations);
  }
  return `${API}/crm/v3/objects/${object}?${params}`;
}

function linked(ids: readonly string[]): {
  associations: { companies: { results: { id: string }[] } };
} {
  return { associations: { companies: { results: ids.map((id) => ({ id })) } } };
}

function hubspotFetcher(): InMemoryFetcher {
  return new InMemoryFetcher()
    .on("GET", listUrl("companies", ["name", "domain", "hs_lastmodifieddate"]), {
      body: { results: COMPANIES },
    })
    .on(
      "GET",
      listUrl("contacts", ["email", "firstname", "lastname", "lastmodifieddate"], "companies"),
      {
        body: { results: CONTACTS.map((contact) => ({ ...contact, ...linked(["101"]) })) },
      },
    )
    .on(
      "GET",
      listUrl(
        "deals",
        ["dealname", "amount", "dealstage", "pipeline", "closedate", "hs_lastmodifieddate"],
        "companies",
      ),
      {
        body: { results: DEALS.map((deal) => ({ ...deal, ...linked(["101"]) })) },
      },
    )
    .on(
      "GET",
      listUrl(
        "quotes",
        [
          "hs_title",
          "hs_status",
          "hs_quote_amount",
          "hs_expiration_date",
          "hs_currency",
          "hs_lastmodifieddate",
        ],
        "deals",
      ),
      {
        body: { results: QUOTES },
      },
    )
    .on("POST", `${API}/crm/v3/objects/companies/batch/read?archived=false`, {
      body: { results: [COMPANIES[0]] },
    })
    .on("GET", `${API}/crm/v4/objects/companies/101/associations/deals?limit=500`, {
      body: { results: [{ toObjectId: 301 }, { toObjectId: 302 }] },
    });
}

function insert(db: Database, table: string, rows: readonly Record<string, string>[]): void {
  for (const row of rows) {
    const columns = Object.keys(row);
    db.run(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
      Object.values(row),
    );
  }
}

function mirror(
  record: { id: string; properties: Record<string, string> },
  overrides: Record<string, string> = {},
): Record<string, string> {
  const { lastmodifieddate, ...properties } = record.properties;
  return {
    hubspot_id: record.id,
    archived: "False",
    pulled_at: PULLED,
    ...properties,
    hs_lastmodifieddate: properties.hs_lastmodifieddate ?? lastmodifieddate ?? MODIFIED,
    ...overrides,
  };
}

function ostwinWorld(): AskPy {
  const db = new Database(":memory:");
  const base = "hubspot_id TEXT, archived TEXT, hs_lastmodifieddate TEXT, pulled_at TEXT";
  db.run(`CREATE TABLE hubspot_companies (${base}, name TEXT, domain TEXT)`);
  db.run(`CREATE TABLE hubspot_contacts (${base}, email TEXT, firstname TEXT, lastname TEXT)`);
  db.run(
    `CREATE TABLE hubspot_deals (${base}, dealname TEXT, amount TEXT, dealstage TEXT, pipeline TEXT, closedate TEXT)`,
  );
  db.run(
    `CREATE TABLE hubspot_quotes (${base}, hs_title TEXT, hs_status TEXT, hs_quote_amount TEXT, hs_expiration_date TEXT, hs_currency TEXT)`,
  );
  db.run(
    "CREATE TABLE hubspot_associations (from_type TEXT, from_id TEXT, to_type TEXT, to_id TEXT, pulled_at TEXT)",
  );
  db.run(
    "CREATE TABLE hubspot_client_link (client_id TEXT, hubspot_company_id_extracted TEXT, join_status TEXT)",
  );
  insert(
    db,
    "hubspot_companies",
    COMPANIES.map((company) => mirror(company)),
  );
  insert(
    db,
    "hubspot_contacts",
    CONTACTS.map((contact) => mirror(contact)),
  );
  // OSTWIN holds the first deal under another name: S2O CONTENT_MISMATCH.
  insert(db, "hubspot_deals", [
    mirror(DEALS[0] ?? { id: "", properties: {} }, { dealname: "Annual fee" }),
    mirror(DEALS[1] ?? { id: "", properties: {} }),
  ]);
  insert(
    db,
    "hubspot_quotes",
    QUOTES.map((quote) => mirror(quote)),
  );
  const links = ["301", "302"].flatMap((deal) => [
    { from_type: "deals", from_id: deal, to_type: "companies", to_id: "101", pulled_at: PULLED },
    { from_type: "companies", from_id: "101", to_type: "deals", to_id: deal, pulled_at: PULLED },
  ]);
  insert(db, "hubspot_associations", links);
  insert(db, "hubspot_client_link", [
    { client_id: "c-99", hubspot_company_id_extracted: "101", join_status: "verified_company" },
  ]);
  return new AskPy(db);
}

function lakeWorld(): LakeCli {
  const lake = new LakeCli();
  lake.connections = [
    {
      kind: "hubspot",
      source: "hubspot",
      status: "connected",
      externalAccountLabel: "",
      config: { properties: {} },
    },
  ];
  lake.runs = [
    {
      id: "r1",
      kind: "ingest",
      source: "hubspot",
      entities: ["associations", "companies", "contacts", "deals"],
      status: "ok",
      startedAt: LAKE_RUN,
      endedAt: LAKE_RUN,
      counts: null,
      error: null,
    },
  ];
  function push(entity: string, record: { id: string; properties: Record<string, string> }): void {
    lake.records.push({
      source: "hubspot",
      entity,
      sourceRecordId: record.id,
      payload: {
        id: record.id,
        archived: false,
        properties: { ...record.properties, createdate: MODIFIED },
      },
    });
  }
  push("companies", COMPANIES[0] ?? { id: "", properties: {} });
  for (const contact of CONTACTS) {
    push("contacts", contact);
  }
  for (const deal of DEALS) {
    push("deals", deal);
  }
  // The lake links only the first deal to its company: the second link is missing.
  lake.records.push({
    source: "hubspot",
    entity: "associations",
    sourceRecordId: "301",
    payload: { from: { id: "301" }, to: [{ toObjectId: 101 }] },
  });
  return lake;
}

const CONFIG: LiveConfig = {
  tenantId: "tenant",
  ostwinRoot: "/legacy",
  outDir: "/tmp/out",
  hubspotEnvFile: "/dev/null",
  mailboxes: {
    primary: { address: "a@example.test", tokenFile: "", undercroftSource: "gmail" },
    secondary: { address: "b@example.test", tokenFile: "", undercroftSource: "gmail.b" },
  },
  driveRoots: [],
  clients: [
    {
      label: "CASE-99",
      caseId: "CASE-99",
      clientId: "c-99",
      hubspotCompanyIds: ["101"],
      driveFolders: [],
    },
  ],
};

async function run(token: string | null = "invented"): Promise<ReadonlyMap<string, TestResult>> {
  const runner = routeCommands(ostwinWorld(), lakeWorld());
  const results = await runHubSpotSuite({
    config: CONFIG,
    ostwin: createOstwinReader(runner, "/legacy"),
    undercroft: createUndercroftReader(runner, "tenant"),
    fetcher: hubspotFetcher(),
    token,
    sink: new MemorySink(),
  });
  return new Map(results.map((result) => [result.id, result] as const));
}

function get(results: ReadonlyMap<string, TestResult>, id: string): TestResult {
  const result = results.get(id);
  if (result === undefined) {
    throw new Error(`no result ${id}; have ${[...results.keys()].join(", ")}`);
  }
  return result;
}

describe("IT-HS the HubSpot suite over an invented portal", () => {
  it("IT-HS-001 a company older than the lake's run and absent from it fails S->U; the mirror passes", async () => {
    const results = await run();
    expect(get(results, "HS-COMPANIES-S2U-001").counts).toMatchObject({ MATCH: 1, MISSING: 1 });
    expect(get(results, "HS-COMPANIES-S2O-001").status).toBe("PASS");
  });

  it("IT-HS-002 a deal OSTWIN holds under another name is a content mismatch on S->O", async () => {
    const s2o = get(await run(), "HS-DEALS-S2O-001");
    expect(s2o.status).toBe("FAIL");
    expect(s2o.counts).toMatchObject({ MATCH: 1, CONTENT_MISMATCH: 1 });
  });

  it("IT-HS-003 1500 and 1500.00 are one amount, so the lake's deals match", async () => {
    expect(get(await run(), "HS-DEALS-S2U-001").status).toBe("PASS");
  });

  it("IT-HS-004 a deal->company link the lake lacks fails the association leg and the client's deal set", async () => {
    const results = await run();
    expect(get(results, "HS-ASSOC-DC-S2U-001").counts).toMatchObject({ MATCH: 1, MISSING: 1 });
    expect(get(results, "HS-CASE-99-DEALS-S2U-001").counts).toMatchObject({ MATCH: 1, MISSING: 1 });
    expect(get(results, "HS-CASE-99-DEALS-S2O-001").status).toBe("PASS");
  });

  it("IT-HS-005 quotes are out of the lake's contract, and the requirement gap is one failing case", async () => {
    const results = await run();
    expect(get(results, "HS-QUOTES-S2O-001").status).toBe("PASS");
    expect(get(results, "HS-QUOTES-S2U-001").status).toBe("OUT_OF_SCOPE");
    expect(get(results, "HS-REQ-OBJ-001").status).toBe("FAIL");
  });

  it("IT-HS-006 two deals recording one event fail the duplicate case; the link case passes", async () => {
    const results = await run();
    expect(get(results, "HS-CASE-99-DUP-001").status).toBe("FAIL");
    expect(get(results, "HS-CASE-99-LINK-001").status).toBe("PASS");
  });

  it("IT-HS-007 without a token every HubSpot case is blocked, not passed", async () => {
    const results = await run(null);
    expect([...results.values()].map((result) => result.status)).toEqual(["BLOCKED"]);
  });
});

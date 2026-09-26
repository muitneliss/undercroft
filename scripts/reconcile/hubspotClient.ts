/**
 * One client's HubSpot cases: the client resolves to the company OSTWIN links and that company
 * is live; its deals, reached from the company, are the same set in each system; and no two of
 * those deals record the same commercial event.
 */

import { legCase, type LegMeta, makeCase, stamp } from "./cases.ts";
import type { ClientConfig } from "./config.ts";
import type { HubSpotClient, HubSpotRecord } from "./hubspot.ts";
import { dealModified, keyed, modifiedBy, pairs, setLeg } from "./hubspotGraph.ts";
import { normal } from "./hubspotObjects.ts";
import type { HubSpotDeps, Universe } from "./hubspotUniverse.ts";
import type { Status, TestResult } from "./model.ts";
import { sqlText } from "./ostwin.ts";

async function linkCase(
  deps: HubSpotDeps,
  client: HubSpotClient,
  entry: ClientConfig,
): Promise<TestResult> {
  const columns = ["client_id", "hubspot_company_id_extracted", "join_status"];
  const where = `WHERE client_id = ${sqlText(entry.clientId)}`;
  const link = await deps.ostwin.fullRows(
    `SELECT ${columns.join(", ")} FROM hubspot_client_link ${where}`,
    columns,
  );
  const linked = link
    .map((row) => row.hubspot_company_id_extracted)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const companies = await client.batchRead("companies", entry.hubspotCompanyIds, ["name"]);
  const ok =
    entry.hubspotCompanyIds.every((id) => linked.includes(id)) && companies.notFound.length === 0;
  return makeCase(
    "hubspot",
    {
      id: `HS-${entry.label}-LINK-001`,
      title: "The client's HubSpot company is the one OSTWIN links, and it is live",
    },
    {
      client: entry.label,
      group: "integration",
      requirement: "REQ-HS-04 a client resolves to live HubSpot company records",
      contract: "OSTWIN client link table; HubSpot companies batch read, live records only",
      preconditions: "config pins the company id(s)",
      expected: "pinned ids = OSTWIN link; every id live in HubSpot",
      actual: `pinned ${entry.hubspotCompanyIds.length}, OSTWIN links ${linked.length}, not live ${companies.notFound.length}`,
      status: ok ? "PASS" : "FAIL",
      reason: ok
        ? ""
        : "the pinned company differs from OSTWIN's link, or is archived/merged in HubSpot",
      evidence: [
        {
          label: "link",
          path: deps.sink.json(`HS-${entry.label}-LINK`, { link, notFound: companies.notFound }),
        },
      ],
    },
  );
}

/** The client's deals as each system links them to its company. */
async function clientDeals(
  client: HubSpotClient,
  universe: Universe,
  entry: ClientConfig,
): Promise<{ source: Set<string>; ostwin: Set<string>; lake: Set<string>; exhausted: boolean }> {
  const source = new Set<string>();
  let exhausted = true;
  for (const company of entry.hubspotCompanyIds) {
    const found = await client.associations("companies", company, "deals");
    exhausted &&= found.exhausted;
    for (const id of found.ids) {
      source.add(id);
    }
  }
  const companies = new Set(entry.hubspotCompanyIds);
  const ostwin = new Set(
    universe.ostwinAssociations
      .filter(
        (row) =>
          row.from_type === "companies" &&
          row.to_type === "deals" &&
          companies.has(row.from_id ?? ""),
      )
      .map((row) => row.to_id ?? ""),
  );
  const lake = new Set(
    [...pairs(universe).lake]
      .filter(([, to]) => to.some((company) => companies.has(company)))
      .map(([deal]) => deal),
  );
  return { source, ostwin, lake, exhausted };
}

export async function clientCases(
  deps: HubSpotDeps,
  client: HubSpotClient,
  universe: Universe,
  entry: ClientConfig,
): Promise<TestResult[]> {
  const deals = await clientDeals(client, universe, entry);
  const modified = dealModified(universe);
  const ostwinMark = universe.ostwinWatermark.get("associations") ?? null;
  const lakeMark = universe.lakeWatermark.get("associations") ?? null;
  const both = ostwinMark === null || lakeMark === null ? null : Math.min(ostwinMark, lakeMark);
  const before = modifiedBy(modified);
  const common: Omit<LegMeta, "id" | "title" | "leg"> = {
    source: "hubspot",
    client: entry.label,
    requirement: "REQ-HS-05 a client's deals are reachable from its company in each warehouse",
    contract:
      "HubSpot v4 associations company->deals; OSTWIN companies->deals; lake deal->companies",
    preconditions: `company id(s) pinned; OSTWIN ${stamp(ostwinMark)}; lake ${stamp(lakeMark)}`,
    expected: "the same deal set on each side",
    facts: { source: deals.source.size, ostwin: deals.ostwin.size, lake: deals.lake.size },
  };
  const prefix = `HS-${entry.label}-DEALS`;
  const records = new Map(
    (universe.source.get("deals")?.records ?? []).map((record) => [record.id, record]),
  );
  return [
    await linkCase(deps, client, entry),
    legCase(
      deps.sink,
      { ...common, id: `${prefix}-S2O-001`, title: "Client deals: source vs OSTWIN", leg: "S2O" },
      setLeg(keyed(deals.source), keyed(deals.ostwin), before(ostwinMark)),
      deals.exhausted,
    ),
    legCase(
      deps.sink,
      {
        ...common,
        id: `${prefix}-S2U-001`,
        title: "Client deals: source vs Undercroft",
        leg: "S2U",
      },
      setLeg(keyed(deals.source), keyed(deals.lake), before(lakeMark)),
      deals.exhausted && lakeMark !== null,
    ),
    legCase(
      deps.sink,
      {
        ...common,
        id: `${prefix}-O2U-001`,
        title: "Client deals: OSTWIN vs Undercroft",
        leg: "O2U",
      },
      setLeg(keyed(deals.ostwin), keyed(deals.lake), before(both)),
      lakeMark !== null,
    ),
    duplicateDealsCase(
      deps,
      entry,
      [...deals.source].flatMap((id) => records.get(id) ?? []),
    ),
  ];
}

/** Two live deals of one client with the same name, amount and close date: a source defect. */
export function duplicateDealsCase(
  deps: Pick<HubSpotDeps, "sink">,
  entry: Pick<ClientConfig, "label">,
  deals: readonly HubSpotRecord[],
): TestResult {
  const groups = new Map<string, string[]>();
  for (const deal of deals) {
    const key = ["dealname", "amount", "closedate"]
      .map((field) => normal(field, deal.properties[field]).toLowerCase())
      .join("|");
    groups.set(key, [...(groups.get(key) ?? []), deal.id]);
  }
  const duplicates = [...groups.values()].filter((ids) => ids.length > 1);
  const status: Status = duplicates.length === 0 ? "PASS" : "FAIL";
  return makeCase(
    "hubspot",
    { id: `HS-${entry.label}-DUP-001`, title: "The client has no duplicated deal in HubSpot" },
    {
      client: entry.label,
      requirement: "REQ-DQ-01 one commercial event is one deal",
      contract: "data quality rule: same dealname + amount + closedate on one company = duplicate",
      finding: "duplicate deal found in the 2026-09-25 HubSpot review",
      preconditions: "client deals listed from HubSpot",
      expected: "no two deals share name, amount and close date",
      actual: `${deals.length} deal(s), ${duplicates.length} duplicated group(s)`,
      status,
      reason:
        status === "PASS"
          ? ""
          : `source data quality: ${duplicates.length} duplicated deal group(s) in HubSpot`,
      evidence: [
        { label: "duplicate groups", path: deps.sink.json(`HS-${entry.label}-DUP`, duplicates) },
      ],
    },
  );
}

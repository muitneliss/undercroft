/**
 * The HubSpot reconciliation: SOURCE (the live portal) <-> OSTWIN (its HubSpot mirror) <->
 * UNDERCROFT (the lake's `hubspot` source).
 *
 * The universe is read once (`hubspotUniverse.ts`); the whole-portal object legs follow
 * (`hubspotObjects.ts`), then the association graph and each client's deals
 * (`hubspotGraph.ts`). A client whose HubSpot data cannot be read becomes that client's
 * BLOCKED case; it does not end the run.
 */

import { makeCase } from "./cases.ts";
import { messageOf } from "./errors.ts";
import { createHubSpotClient } from "./hubspot.ts";
import { clientCases } from "./hubspotClient.ts";
import { dealCompanyLegs, quoteLegs } from "./hubspotGraph.ts";
import { objectLegs, objectTypesCase } from "./hubspotObjects.ts";
import { type HubSpotDeps, loadUniverse, MIRRORED } from "./hubspotUniverse.ts";
import type { TestResult } from "./model.ts";

export type { HubSpotDeps } from "./hubspotUniverse.ts";

function noToken(): TestResult {
  return makeCase(
    "hubspot",
    { id: "HS-PRE-001", title: "A HubSpot token is available to read the source" },
    {
      group: "integration",
      requirement: "REQ-GEN-01 the source is read live",
      contract: "hubspot.env HUBSPOT_ACCESS_TOKEN (read scopes)",
      preconditions: "token file present",
      expected: "token found",
      actual: "no HUBSPOT_ACCESS_TOKEN",
      status: "BLOCKED",
      reason: "no HubSpot token: every HubSpot case is undecided",
      evidence: [],
    },
  );
}

export async function runHubSpotSuite(deps: HubSpotDeps): Promise<TestResult[]> {
  if (deps.token === null) {
    return [noToken()];
  }
  const client = createHubSpotClient(deps.fetcher, deps.token);
  const universe = await loadUniverse(deps, client);
  const results: TestResult[] = [objectTypesCase(deps, universe)];
  for (const object of MIRRORED) {
    results.push(...objectLegs(deps, universe, object));
  }
  results.push(...dealCompanyLegs(deps, universe), ...quoteLegs(deps, universe));
  for (const entry of deps.config.clients) {
    try {
      results.push(...(await clientCases(deps, client, universe, entry)));
    } catch (error) {
      results.push(
        makeCase(
          "hubspot",
          { id: `HS-${entry.label}-RUN`, title: `HubSpot cases for ${entry.label}` },
          {
            client: entry.label,
            requirement: "REQ-GEN-01 the source is read live",
            contract: "HubSpot CRM v3/v4 read APIs",
            preconditions: "HubSpot readable",
            expected: "client cases run",
            actual: "not run",
            status: "BLOCKED",
            reason: messageOf(error),
            evidence: [],
          },
        ),
      );
    }
  }
  return results;
}

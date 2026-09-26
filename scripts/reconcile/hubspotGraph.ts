/**
 * The HubSpot association graph: deal->company links portal-wide, quotes, and each client's
 * deals reached from its company -- where a client's commercial picture is lost when a
 * warehouse's associations are thin.
 *
 * QUOTES ARE A CONTRACT GAP, NOT AN INGESTION DEFECT. Undercroft's connector declares no quotes
 * entity, so a quote absent from the lake is OUT_OF_SCOPE on each leg; the gap against the
 * business requirement is stated once, in HS-REQ-OBJ-001.
 */

import { type Keyed, reconcileLeg } from "./classify.ts";
import { legCase, type LegMeta, makeCase, stamp } from "./cases.ts";
import { diff, isTrue, modifiedAt } from "./hubspotObjects.ts";
import { type HubSpotDeps, QUOTE_FIELDS, type Universe } from "./hubspotUniverse.ts";
import { arrayOrEmpty, asObject, text } from "./json.ts";
import { hubspotId } from "./keys.ts";
import type { Leg, TestResult } from "./model.ts";

type PairMap = Map<string, string[]>;

/** deal -> company links as each system holds them. */
export function pairs(universe: Universe): { source: PairMap; ostwin: PairMap; lake: PairMap } {
  const source: PairMap = new Map(
    [...(universe.source.get("deals")?.associations ?? [])].map(([deal, companies]) => [
      deal,
      [...companies],
    ]),
  );
  const ostwin: PairMap = new Map();
  for (const row of universe.ostwinAssociations) {
    const from = row.from_id ?? null;
    const to = row.to_id ?? null;
    if (row.from_type === "deals" && row.to_type === "companies" && from !== null && to !== null) {
      ostwin.set(from, [...(ostwin.get(from) ?? []), to]);
    }
  }
  const lake: PairMap = new Map();
  for (const record of universe.lake.get("associations") ?? []) {
    const links = arrayOrEmpty(asObject(record.payload).to);
    lake.set(
      record.sourceRecordId,
      links.map((link) => text(asObject(link).toObjectId)),
    );
  }
  return { source, ostwin, lake };
}

export function pairKeys(map: ReadonlyMap<string, readonly string[]>): Keyed<string>[] {
  return [...map].flatMap(([deal, companies]) =>
    [...new Set(companies)].map((company) => ({
      key: `${deal}->${company}`,
      record: deal,
      evidence: `deal ${deal} -> company ${company}`,
    })),
  );
}

export function dealModified(universe: Universe): (deal: string) => number {
  const deals = new Map(
    (universe.source.get("deals")?.records ?? []).map((record) => [record.id, record]),
  );
  return (deal: string): number => {
    const record = deals.get(deal);
    return record === undefined
      ? Number.POSITIVE_INFINITY
      : modifiedAt(record, "hs_lastmodifieddate");
  };
}

/** A `synced` predicate: the deal was last modified at or before the watermark. */
export function modifiedBy(
  modified: (deal: string) => number,
): (mark: number | null) => (deal: string) => boolean {
  return (mark) => (deal) => mark !== null && modified(deal) <= mark;
}

export function keyed(ids: ReadonlySet<string>): Keyed<string>[] {
  return [...ids].map((id) => ({ key: id, record: id, evidence: `deal ${id}` }));
}

export function setLeg(
  reference: readonly Keyed<string>[],
  target: readonly Keyed<string>[],
  synced: (deal: string) => boolean,
): ReturnType<typeof reconcileLeg<string, string>> {
  return reconcileLeg({
    reference,
    target,
    inScope: () => ({ inScope: true, reason: "" }),
    synced,
    compare: () => [],
    targetBelongs: () => true,
  });
}

function linkTitle(left: string, right: string): string {
  return `Deal->company links: ${left} vs ${right}`;
}

function pairFacts(universe: Universe, held: ReturnType<typeof pairs>): Record<string, number> {
  const deals = universe.source.get("deals")?.records ?? [];
  return {
    sourceDeals: deals.length,
    sourcePairs: pairKeys(held.source).length,
    ostwinPairs: pairKeys(held.ostwin).length,
    lakePairs: pairKeys(held.lake).length,
    orphanDeals: deals.filter((deal) => (held.source.get(deal.id) ?? []).length === 0).length,
    multiCompanyDeals: [...held.source.values()].filter((companies) => new Set(companies).size > 1)
      .length,
  };
}

export function dealCompanyLegs(deps: HubSpotDeps, universe: Universe): TestResult[] {
  const held = pairs(universe);
  const before = modifiedBy(dealModified(universe));
  const ostwinMark = universe.ostwinWatermark.get("associations") ?? null;
  const lakeMark = universe.lakeWatermark.get("associations") ?? null;
  const both = ostwinMark === null || lakeMark === null ? null : Math.min(ostwinMark, lakeMark);
  const common: Omit<LegMeta, "id" | "title" | "leg"> = {
    source: "hubspot",
    requirement:
      "REQ-HS-03 every deal keeps its company links, so a deal can be attributed to a client",
    contract:
      "OSTWIN hubspot_associations deals->companies; Undercroft associations entity (deal -> companies)",
    preconditions: `source deals listed with associations; OSTWIN ${stamp(ostwinMark)}; lake ${stamp(lakeMark)}`,
    expected: "every deal->company link present on each side",
    finding: "Undercroft associations low (deep research 2026-09-25)",
    facts: pairFacts(universe, held),
  };
  const complete = universe.source.get("deals")?.exhausted ?? false;
  const [source, ostwin, lake] = [
    pairKeys(held.source),
    pairKeys(held.ostwin),
    pairKeys(held.lake),
  ];
  return [
    legCase(
      deps.sink,
      { ...common, id: "HS-ASSOC-DC-S2O-001", title: linkTitle("source", "OSTWIN"), leg: "S2O" },
      setLeg(source, ostwin, before(ostwinMark)),
      complete,
    ),
    legCase(
      deps.sink,
      {
        ...common,
        id: "HS-ASSOC-DC-S2U-001",
        title: linkTitle("source", "Undercroft"),
        leg: "S2U",
      },
      setLeg(source, lake, before(lakeMark)),
      complete && lakeMark !== null,
    ),
    legCase(
      deps.sink,
      {
        ...common,
        id: "HS-ASSOC-DC-O2U-001",
        title: linkTitle("OSTWIN", "Undercroft"),
        leg: "O2U",
      },
      setLeg(ostwin, lake, before(both)),
      lakeMark !== null,
    ),
  ];
}

export function quoteLegs(deps: HubSpotDeps, universe: Universe): TestResult[] {
  const listing = universe.source.get("quotes");
  const mark = universe.ostwinWatermark.get("quotes") ?? null;
  const reference = (listing?.records ?? []).map((record) => ({
    key: record.id,
    record,
    evidence: `hubspot:quotes/${record.id}`,
  }));
  const target = (universe.ostwin.get("quotes") ?? []).flatMap((row) => {
    const key = hubspotId(row.hubspot_id);
    return key === null ? [] : [{ key, record: row, evidence: "ostwin:hubspot_quotes" }];
  });
  const s2o = reconcileLeg({
    reference,
    target,
    inScope: () => ({ inScope: true, reason: "" }),
    synced: (record) => mark !== null && modifiedAt(record, "hs_lastmodifieddate") <= mark,
    compare: (record, row) => diff(QUOTE_FIELDS, record.properties, row),
    targetBelongs: (row) => !isTrue(row.archived),
  });
  const held = universe.lakeEntities.includes("quotes");
  function outOfScope(leg: Leg): TestResult {
    return makeCase(
      "hubspot",
      {
        id: `HS-QUOTES-${leg}-001`,
        title: `HubSpot quotes: ${leg === "S2U" ? "source" : "OSTWIN"} vs Undercroft`,
      },
      {
        leg,
        requirement: "REQ-HS-01 quotes held in the warehouse",
        contract: "specs/connectors/hubspot.yaml declares no quotes entity",
        preconditions: "lake entities listed",
        expected: "not asked: the lake's contract does not include quotes",
        actual: `${reference.length} live quote(s) in HubSpot; lake entities: ${universe.lakeEntities.join(", ")}`,
        status: held ? "PENDING" : "OUT_OF_SCOPE",
        reason: held
          ? "the lake now has quotes; this suite does not compare them yet"
          : "Undercroft's contract has no quotes entity; the gap is stated once in HS-REQ-OBJ-001",
        evidence: [],
      },
    );
  }
  const meta: LegMeta = {
    source: "hubspot",
    id: "HS-QUOTES-S2O-001",
    title: "HubSpot quotes: source vs OSTWIN",
    leg: "S2O",
    requirement: "REQ-HS-01 quotes held in the warehouse",
    contract: "OSTWIN hubspot_quotes mirror",
    preconditions: `quotes listed; OSTWIN ${stamp(mark)}`,
    expected: "every live quote mirrored with title, status, amount, expiry, currency",
    facts: { reference: reference.length, target: target.length },
  };
  return [
    legCase(deps.sink, meta, s2o, listing?.exhausted ?? false),
    outOfScope("S2U"),
    outOfScope("O2U"),
  ];
}

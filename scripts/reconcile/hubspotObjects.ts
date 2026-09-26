/**
 * The whole-portal HubSpot cases: whether the lake collects the object types the business
 * uses, and the S->O, S->U and O->U legs for companies, contacts and deals, id by id.
 *
 * BOTH WAREHOUSES MIRROR THE WHOLE PORTAL, so these legs are not client-scoped. S->U compares
 * only the fields Undercroft reads (the connector's property floor plus the connection's
 * selection); a field it never promised is not a difference.
 */

import { parseAmount } from "../../packages/core/src/money.ts";
import { type Keyed, reconcileLeg } from "./classify.ts";
import { legCase, type LegMeta, makeCase, stamp } from "./cases.ts";
import type { HubSpotRecord } from "./hubspot.ts";
import { type HubSpotDeps, type Mirrored, OBJECTS, type Universe } from "./hubspotUniverse.ts";
import { asObject, objectOrEmpty } from "./json.ts";
import { hubspotId } from "./keys.ts";
import type { FieldDiff, Leg, TestResult } from "./model.ts";
import type { Row } from "./ostwin.ts";
import type { LakeRecord } from "./undercroft.ts";

const WHITESPACE = /\s+/gu;
const DATE_PART = /^(?<day>\d{4}-\d{2}-\d{2})/u;

/** The object types OSTWIN mirrors from HubSpot, as the business uses them. */
const BUSINESS_OBJECTS = [
  "companies",
  "contacts",
  "deals",
  "quotes",
  "line_items",
  "products",
  "owners",
];

export interface LakeObject {
  readonly archived: boolean;
  readonly properties: Row;
}

export function lakeObject(record: LakeRecord): LakeObject {
  const payload = asObject(record.payload);
  const properties: Row = {};
  for (const [name, value] of Object.entries(objectOrEmpty(payload.properties))) {
    properties[name] = value === null || value === undefined ? null : String(value);
  }
  return { archived: payload.archived === true, properties };
}

export function modifiedAt(record: HubSpotRecord, field: string): number {
  const at = Date.parse(record.properties[field] ?? record.updatedAt);
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : at;
}

/** Normalise a HubSpot value for comparison: whitespace squashed, dates to the day. */
export function normal(field: string, value: string | null | undefined): string {
  const text = (value ?? "").replace(WHITESPACE, " ").trim();
  if (field === "closedate" || field === "hs_expiration_date") {
    return DATE_PART.exec(text)?.groups?.day ?? text;
  }
  if (field === "amount" || field === "hs_quote_amount") {
    // "1500", "1500.0" and "1500.00" are one amount; compare them as decimals, never floats.
    return parseAmount(text)?.toString() ?? text;
  }
  return field === "email" || field === "domain" ? text.toLowerCase() : text;
}

export function diff(
  fields: readonly string[],
  left: Readonly<Record<string, string | null | undefined>>,
  right: Readonly<Record<string, string | null | undefined>>,
): FieldDiff[] {
  const out: FieldDiff[] = [];
  for (const field of fields) {
    const expected = normal(field, left[field]);
    const actual = normal(field, right[field]);
    if (expected !== actual) {
      out.push({ field, expected, actual });
    }
  }
  return out;
}

/** The record existed when the snapshot began, so the snapshot should hold it. */
export function createdBy(copy: LakeObject, mark: number | null): boolean {
  const created = Date.parse(copy.properties.createdate ?? "");
  return mark !== null && !Number.isNaN(created) && created <= mark;
}

export function isTrue(value: string | null | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

export function objectTypesCase(deps: Pick<HubSpotDeps, "sink">, universe: Universe): TestResult {
  const collected = BUSINESS_OBJECTS.filter((object) => universe.lakeEntities.includes(object));
  const missing = BUSINESS_OBJECTS.filter((object) => !universe.lakeEntities.includes(object));
  const evidence = deps.sink.json("HS-REQ-OBJ-001", {
    business: BUSINESS_OBJECTS,
    lakeEntities: universe.lakeEntities,
    collected,
    missing,
  });
  return makeCase(
    "hubspot",
    {
      id: "HS-REQ-OBJ-001",
      title: "Undercroft collects the HubSpot object types the business uses",
    },
    {
      group: "contract",
      requirement: "REQ-HS-01 the lake holds the commercial picture, quotes included",
      contract: "specs/connectors/hubspot.yaml entities vs OSTWIN hubspot_* mirror",
      finding: "historical claim: 3/7 object types",
      preconditions: "lake summary readable",
      expected: `all of ${BUSINESS_OBJECTS.join(", ")}`,
      actual: `${collected.length}/${BUSINESS_OBJECTS.length} collected (${collected.join(", ")}); not collected: ${missing.join(", ")}`,
      status: missing.length === 0 ? "PASS" : "FAIL",
      reason:
        missing.length === 0
          ? ""
          : `requirement gap, not an ingestion defect: the connector does not declare ${missing.join(", ")}`,
      evidence: [{ label: "object types", path: evidence }],
    },
  );
}

interface Sides {
  readonly reference: readonly Keyed<HubSpotRecord>[];
  readonly ostwin: readonly Keyed<Row>[];
  readonly lake: readonly Keyed<LakeObject>[];
}

function sides(universe: Universe, object: Mirrored): Sides {
  const reference = (universe.source.get(object)?.records ?? []).map((record) => ({
    key: record.id,
    record,
    evidence: `hubspot:${object}/${record.id}`,
  }));
  const ostwin = (universe.ostwin.get(object) ?? []).flatMap((row) => {
    const key = hubspotId(row.hubspot_id);
    return key === null
      ? []
      : [
          {
            key,
            record: row,
            evidence: `ostwin:hubspot_${object} pulled_at=${row.pulled_at ?? "?"}`,
          },
        ];
  });
  const lake = (universe.lake.get(object) ?? []).flatMap((record) => {
    const key = hubspotId(record.sourceRecordId);
    return key === null
      ? []
      : [
          {
            key,
            record: lakeObject(record),
            evidence: `lake:hubspot/${object}/${record.sourceRecordId} run=${record.runId}`,
          },
        ];
  });
  return { reference, ostwin, lake };
}

function meta(
  object: Mirrored,
  leg: Leg,
  preconditions: string,
): Omit<LegMeta, "id" | "title" | "facts"> {
  return {
    source: "hubspot",
    leg,
    requirement: `REQ-HS-02 every live HubSpot ${object} record is mirrored once with its contract fields`,
    contract:
      leg === "S2O"
        ? "OSTWIN hubspot_* mirror (full portal pull)"
        : "specs/connectors/hubspot.yaml property floor + connection selection",
    preconditions,
    expected: "no MISSING, EXTRA, DUPLICATE or CONTENT_MISMATCH",
  };
}

interface ObjectRead {
  readonly object: Mirrored;
  readonly sides: Sides;
  /** The contract fields Undercroft reads for the object (floor plus selection). */
  readonly lakeFields: readonly string[];
  readonly ostwinMark: number | null;
  readonly lakeMark: number | null;
  readonly sourceComplete: boolean;
  readonly lakeComplete: boolean;
  readonly preconditions: string;
}

function readObject(universe: Universe, object: Mirrored): ObjectRead {
  const listing = universe.source.get(object);
  const ostwinMark = universe.ostwinWatermark.get(object) ?? null;
  const lakeMark = universe.lakeWatermark.get(object) ?? null;
  const sourceComplete = (listing?.exhausted ?? false) && listing?.repeats === 0;
  return {
    object,
    sides: sides(universe, object),
    lakeFields: OBJECTS[object].fields.filter(
      (field) => universe.lakeProperties.get(object)?.has(field) ?? false,
    ),
    ostwinMark,
    lakeMark,
    sourceComplete,
    lakeComplete: (universe.lakeComplete.get(object) ?? false) && lakeMark !== null,
    preconditions: `source listing complete=${sourceComplete}; OSTWIN snapshot ${stamp(ostwinMark)}; lake read ${stamp(lakeMark)}`,
  };
}

function s2oLeg(deps: HubSpotDeps, read: ObjectRead): TestResult {
  const spec = OBJECTS[read.object];
  const { reference, ostwin } = read.sides;
  const records = reconcileLeg({
    reference,
    target: ostwin,
    inScope: () => ({ inScope: true, reason: "" }),
    synced: (record) =>
      read.ostwinMark !== null && modifiedAt(record, spec.modified) <= read.ostwinMark,
    compare: (record, row) => diff(spec.fields, record.properties, row),
    targetBelongs: (row) => !isTrue(row.archived),
  });
  const id = `HS-${read.object.toUpperCase()}-S2O-001`;
  const facts = { reference: reference.length, target: ostwin.length, fields: spec.fields };
  return legCase(
    deps.sink,
    {
      ...meta(read.object, "S2O", read.preconditions),
      id,
      title: `HubSpot ${read.object}: source vs OSTWIN`,
      facts,
    },
    records,
    read.sourceComplete,
  );
}

function s2uLeg(deps: HubSpotDeps, read: ObjectRead): TestResult {
  const spec = OBJECTS[read.object];
  const { reference, lake } = read.sides;
  const records = reconcileLeg({
    reference,
    target: lake,
    inScope: () => ({ inScope: true, reason: "" }),
    synced: (record) =>
      read.lakeMark !== null && modifiedAt(record, spec.modified) <= read.lakeMark,
    compare: (record, copy) => diff(read.lakeFields, record.properties, copy.properties),
    targetBelongs: (copy) => !copy.archived,
  });
  const id = `HS-${read.object.toUpperCase()}-S2U-001`;
  const facts = { reference: reference.length, target: lake.length, fields: read.lakeFields };
  return legCase(
    deps.sink,
    {
      ...meta(read.object, "S2U", read.preconditions),
      id,
      title: `HubSpot ${read.object}: source vs Undercroft`,
      facts,
    },
    records,
    read.sourceComplete && read.lakeComplete,
  );
}

function o2uLeg(deps: HubSpotDeps, read: ObjectRead): TestResult {
  const { ostwin, lake } = read.sides;
  const live = ostwin.filter((entry) => !isTrue(entry.record.archived));
  const both =
    read.ostwinMark === null || read.lakeMark === null
      ? null
      : Math.min(read.ostwinMark, read.lakeMark);
  const records = reconcileLeg({
    reference: live,
    target: lake,
    inScope: () => ({ inScope: true, reason: "" }),
    // A row changed after either snapshot began cannot be held against the other.
    synced: (row) => both !== null && Date.parse(row.hs_lastmodifieddate ?? "") <= both,
    compare: (row, copy) => diff(read.lakeFields, row, copy.properties),
    // A lake record created after OSTWIN's snapshot began is OSTWIN's lag, not a lake extra.
    targetBelongs: (copy) => !copy.archived && createdBy(copy, read.ostwinMark),
  });
  const id = `HS-${read.object.toUpperCase()}-O2U-001`;
  const facts = { reference: live.length, target: lake.length, fields: read.lakeFields };
  return legCase(
    deps.sink,
    {
      ...meta(read.object, "O2U", read.preconditions),
      id,
      title: `HubSpot ${read.object}: OSTWIN vs Undercroft`,
      facts,
    },
    records,
    read.lakeComplete && read.ostwinMark !== null,
  );
}

export function objectLegs(deps: HubSpotDeps, universe: Universe, object: Mirrored): TestResult[] {
  const read = readObject(universe, object);
  return [s2oLeg(deps, read), s2uLeg(deps, read), o2uLeg(deps, read)];
}

/**
 * Everything the HubSpot cases compare, read once per run: the live portal's companies,
 * contacts, deals and quotes; OSTWIN's mirror of them and of their associations; and the lake's
 * `hubspot` records -- each with the moment it is "as of".
 *
 * WATERMARKS. OSTWIN's mirror is as of the EARLIEST `pulled_at` of each table: a record
 * changed after its pull began may or may not be in the snapshot, so nothing after that moment
 * is held against it. The lake is as of the start of its last completed run that read the
 * entity. A record modified in HubSpot after a warehouse's watermark is lag, not a defect.
 */

import { stamp } from "./cases.ts";
import type { LiveConfig } from "./config.ts";
import type { EvidenceSink } from "./evidence.ts";
import type { HubSpotClient, HubSpotObject, Listing } from "./hubspot.ts";
import { arrayOrEmpty, objectOrEmpty, text } from "./json.ts";
import type { OstwinReader, Row } from "./ostwin.ts";
import type { LakeRecord, Run, UndercroftReader } from "./undercroft.ts";
import type { Fetcher } from "../../packages/connector-runtime/src/fetcher.ts";

export type Mirrored = "companies" | "contacts" | "deals";
export const MIRRORED: readonly Mirrored[] = ["companies", "contacts", "deals"];

export interface ObjectSpec {
  /** Fields every contract preserves for the object. */
  readonly fields: readonly string[];
  /** The source's last-modified property for the object. */
  readonly modified: string;
  /** The association listed with the object, for the graph cases. */
  readonly associate?: HubSpotObject;
}

export const OBJECTS: Readonly<Record<Mirrored, ObjectSpec>> = {
  companies: { fields: ["name", "domain"], modified: "hs_lastmodifieddate" },
  contacts: {
    fields: ["email", "firstname", "lastname"],
    modified: "lastmodifieddate",
    associate: "companies",
  },
  deals: {
    fields: ["dealname", "amount", "dealstage", "pipeline", "closedate"],
    modified: "hs_lastmodifieddate",
    associate: "companies",
  },
};

/** The connector spec's property floor per object (`specs/connectors/hubspot.yaml`). */
const FLOOR: Readonly<Record<Mirrored, readonly string[]>> = {
  companies: [
    "name",
    "domain",
    "industry",
    "lifecyclestage",
    "createdate",
    "hs_lastmodifieddate",
    "hubspot_owner_id",
  ],
  contacts: [
    "firstname",
    "lastname",
    "email",
    "company",
    "createdate",
    "lastmodifieddate",
    "hubspot_owner_id",
  ],
  deals: [
    "dealname",
    "dealstage",
    "pipeline",
    "amount",
    "closedate",
    "createdate",
    "hs_lastmodifieddate",
    "hubspot_owner_id",
  ],
};

export const QUOTE_FIELDS = [
  "hs_title",
  "hs_status",
  "hs_quote_amount",
  "hs_expiration_date",
  "hs_currency",
];

export interface HubSpotDeps {
  readonly config: LiveConfig;
  readonly ostwin: OstwinReader;
  readonly undercroft: UndercroftReader;
  readonly fetcher: Fetcher;
  readonly token: string | null;
  readonly sink: EvidenceSink;
}

export interface Universe {
  readonly source: ReadonlyMap<string, Listing>;
  readonly ostwin: ReadonlyMap<string, readonly Row[]>;
  readonly ostwinAssociations: readonly Row[];
  readonly ostwinWatermark: ReadonlyMap<string, number | null>;
  readonly lake: ReadonlyMap<string, readonly LakeRecord[]>;
  readonly lakeComplete: ReadonlyMap<string, boolean>;
  readonly lakeWatermark: ReadonlyMap<string, number | null>;
  readonly lakeEntities: readonly string[];
  readonly lakeProperties: ReadonlyMap<string, ReadonlySet<string>>;
}

function earliest(rows: readonly Row[]): number | null {
  const times = rows
    .map((row) => Date.parse(row.pulled_at ?? ""))
    .filter((at) => !Number.isNaN(at));
  return times.length === 0 ? null : times.reduce((low, at) => Math.min(low, at));
}

function lastRead(runs: readonly Run[], entity: string): number | null {
  const run = runs.find(
    (entry) =>
      entry.source === "hubspot" &&
      entry.kind === "ingest" &&
      entry.status === "ok" &&
      entry.entities.includes(entity),
  );
  return run === undefined ? null : Date.parse(run.startedAt);
}

async function readSource(client: HubSpotClient): Promise<Map<string, Listing>> {
  const source = new Map<string, Listing>();
  for (const object of MIRRORED) {
    const spec = OBJECTS[object];
    source.set(
      object,
      await client.listAll(object, [...spec.fields, spec.modified], spec.associate),
    );
  }
  source.set(
    "quotes",
    await client.listAll("quotes", [...QUOTE_FIELDS, "hs_lastmodifieddate"], "deals"),
  );
  return source;
}

async function readOstwin(
  ostwin: OstwinReader,
): Promise<Pick<Universe, "ostwin" | "ostwinAssociations" | "ostwinWatermark">> {
  const tables = new Map<string, readonly Row[]>();
  const marks = new Map<string, number | null>();
  const wanted: readonly (readonly [string, readonly string[]])[] = [
    ...MIRRORED.map((object) => [object, OBJECTS[object].fields] as const),
    ["quotes", QUOTE_FIELDS],
  ];
  for (const [object, fields] of wanted) {
    const columns = ["hubspot_id", "archived", "hs_lastmodifieddate", "pulled_at", ...fields];
    const rows = await ostwin.fullRows(
      `SELECT ${columns.join(", ")} FROM hubspot_${object}`,
      columns,
    );
    tables.set(object, rows);
    marks.set(object, earliest(rows));
  }
  const columns = ["from_type", "from_id", "to_type", "to_id", "pulled_at"];
  const associations = await ostwin.fullRows(
    `SELECT ${columns.join(", ")} FROM hubspot_associations WHERE from_type IN ('deals', 'companies')`,
    columns,
  );
  marks.set("associations", earliest(associations));
  return { ostwin: tables, ostwinAssociations: associations, ostwinWatermark: marks };
}

async function readLake(
  undercroft: UndercroftReader,
): Promise<
  Pick<Universe, "lake" | "lakeComplete" | "lakeWatermark" | "lakeEntities" | "lakeProperties">
> {
  const summary = await undercroft.summary();
  const runs = await undercroft.runs(100);
  const selected = objectOrEmpty(
    (await undercroft.connections()).find((entry) => entry.source === "hubspot")?.config.properties,
  );
  const lakeProperties = new Map<string, ReadonlySet<string>>(
    MIRRORED.map((object) => [
      object,
      new Set([...FLOOR[object], ...arrayOrEmpty(selected[object]).map(text)]),
    ]),
  );
  const lake = new Map<string, readonly LakeRecord[]>();
  const lakeComplete = new Map<string, boolean>();
  const lakeWatermark = new Map<string, number | null>();
  for (const entity of [...MIRRORED, "associations"]) {
    const declared = summary.records.find(
      (stream) => stream.source === "hubspot" && stream.entity === entity,
    )?.records;
    const walk = await undercroft.records("hubspot", entity, declared);
    lake.set(entity, walk.items);
    lakeComplete.set(entity, walk.exhausted && walk.repeats.size === 0);
    lakeWatermark.set(entity, lastRead(runs, entity));
  }
  const lakeEntities = summary.records
    .filter((stream) => stream.source === "hubspot")
    .map((stream) => stream.entity);
  return { lake, lakeComplete, lakeWatermark, lakeEntities, lakeProperties };
}

function iso(map: ReadonlyMap<string, number | null>): Record<string, string> {
  return Object.fromEntries([...map].map(([key, at]) => [key, stamp(at)]));
}

export async function loadUniverse(deps: HubSpotDeps, client: HubSpotClient): Promise<Universe> {
  const universe: Universe = {
    source: await readSource(client),
    ...(await readOstwin(deps.ostwin)),
    ...(await readLake(deps.undercroft)),
  };
  deps.sink.json("HS-universe", {
    source: Object.fromEntries(
      [...universe.source].map(([object, listing]) => [
        object,
        { records: listing.records.length, exhausted: listing.exhausted, repeats: listing.repeats },
      ]),
    ),
    ostwin: Object.fromEntries([...universe.ostwin].map(([object, rows]) => [object, rows.length])),
    ostwinAssociations: universe.ostwinAssociations.length,
    ostwinWatermark: iso(universe.ostwinWatermark),
    lake: Object.fromEntries([...universe.lake].map(([entity, rows]) => [entity, rows.length])),
    lakeComplete: Object.fromEntries(universe.lakeComplete),
    lakeWatermark: iso(universe.lakeWatermark),
    lakeEntities: universe.lakeEntities,
  });
  return universe;
}

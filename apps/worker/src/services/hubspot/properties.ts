/**
 * HubSpot's properties: which of them an admin may choose for a CRM object, and how a choice
 * widens that object's read.
 *
 * Both halves live here because both are ONE piece of knowledge about HubSpot -- that a CRM object
 * is listed at `/crm/v3/objects/{objectType}`, that the properties it carries are named in one
 * comma-separated `properties` parameter, and that `/crm/v3/properties/{objectType}` says which
 * exist. Split between the listing and the run, that knowledge would be written twice and could
 * disagree about which entities take a choice at all.
 *
 * The spec stays the connector (`specs/connectors/hubspot.yaml`): which objects exist, where they
 * live and the properties each ALWAYS reads are all read off it, so an object the spec gains later
 * is listed and widened with no change here. What this module adds is the one thing a spec cannot
 * say -- that a person may add to a list the spec wrote. The generic runtime never learns there
 * was a scope: it is handed an entity whose batch read already asks for the union. ADR 0052, and
 * ADR 0054 for why the union goes in a batch read's body rather than in the list's URL.
 *
 * ## The spec's list is a floor
 *
 * A choice is unioned with the spec's `properties:`, never substituted for it. The spec's list
 * holds the property each object's incremental cursor is read from -- `hs_lastmodifieddate`, and
 * on contacts `lastmodifieddate` -- and a scope able to replace it could untick that property and
 * leave a cursor that never advances, on a read that reports success every day.
 */

import type {
  BrowseScopeResponse,
  ConnectorEntity,
  ConnectorSpec,
  HubspotScope,
} from "@undercroft/contracts";
import type { ByteFetcher } from "@undercroft/core";
import { raiseForByteStatus } from "@undercroft/core";

type BrowseItem = BrowseScopeResponse["items"][number];

/** Where HubSpot lists a CRM object. Its last segment is the object type the properties API takes. */
const OBJECT_LIST = /^\/crm\/v3\/objects\/(?<objectType>[^/]+)$/u;

/** The query parameter a HubSpot object list names its properties in, and how it separates them. */
const PROPERTIES = "properties";
const SEPARATOR = ",";

/** Where HubSpot reads an object's records by id, below the path it lists them at. */
const BATCH_READ = "/batch/read";

/**
 * The HubSpot object an entity lists, when a choice of properties can widen its read -- or null.
 *
 * Only a `list` of a CRM object whose spec ALREADY names its properties. An entity with no
 * `properties` query reads HubSpot's own default set, and adding a parameter to it would narrow
 * that read to what was chosen rather than widen it; the associations relation is a POST to
 * another route and carries no properties at all.
 */
function objectTypeOf(entity: ConnectorEntity): string | null {
  const { request } = entity;
  if (request.kind !== "list" || request.query[PROPERTIES] === undefined) {
    return null;
  }
  return OBJECT_LIST.exec(request.path)?.groups?.objectType ?? null;
}

/** The properties the spec reads on this entity whatever is chosen, in the spec's order. */
function floorOf(entity: ConnectorEntity): string[] {
  const listed = entity.request.kind === "list" ? entity.request.query[PROPERTIES] : undefined;
  return (listed ?? "")
    .split(SEPARATOR)
    .map((name) => name.trim())
    .filter((name) => name !== "");
}

/**
 * The entity as a HubSpot scope reads it: listed exactly as the spec declares it, and each page
 * then read whole by HubSpot's batch read, asking for the spec's properties followed by each
 * chosen one the spec does not already read, in a stable order.
 *
 * Two steps rather than a longer list URL (ADR 0054, extending ADR 0052). The list's properties
 * travel in its query string, which has a ceiling, and a portal's full list of contact properties
 * is longer than that on its own; the batch read takes them in a POST body, which does not. The
 * list keeps asking for the spec's own properties, so it still carries the cursor's property and
 * the watermark filters it as before; the batch read asks for those too, so every landed record
 * carries the cursor it is marked by. It is not the search endpoint, and has no 10,000 cap.
 *
 * Returns the SAME entity when the choice adds nothing -- no scope, an empty choice, or only names
 * the spec already reads -- which is what lets a run tell "read as the spec declares" from "read
 * as a scope widened it" by identity (`specRun.ts`), and so keep today's cursor for the first.
 * Sorted rather than in ticking order, so saving the same set twice asks HubSpot the same
 * question twice and does not throw away a watermark over nothing.
 *
 * A chosen name HubSpot no longer has is sent like any other. HubSpot answers by leaving it out
 * of every record, and nothing downstream of that answer invents a value for it.
 */
export function withChosenProperties(
  entity: ConnectorEntity,
  scope: HubspotScope,
): ConnectorEntity {
  const { request } = entity;
  const chosen = scope.properties[entity.name] ?? [];
  if (request.kind !== "list" || objectTypeOf(entity) === null || chosen.length === 0) {
    return entity;
  }
  const floor = floorOf(entity);
  const added = [...new Set(chosen)]
    .filter((name) => !floor.includes(name))
    .toSorted((a, b) => a.localeCompare(b, "en"));
  if (added.length === 0) {
    return entity;
  }
  return {
    ...entity,
    request: {
      ...request,
      batchRead: {
        path: `${request.path}${BATCH_READ}`,
        bodyTemplate: "hubspot-batch-read",
        properties: [...floor, ...added],
      },
    },
  };
}

export interface PropertiesDeps {
  readonly fetcher: ByteFetcher;
  /** A property, not a method: it is passed by reference, and a method would carry `this`. */
  readonly token: () => Promise<string>;
}

/** One property as HubSpot's properties API describes it: an object whose fields are unproven. */
type PropertyRow = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is PropertyRow {
  return typeof value === "object" && value !== null;
}

/**
 * Every property an admin may choose, for every object the spec reads, in spec order.
 *
 * Asked of HubSpot live, because a portal adds properties of its own and a list frozen in the
 * repo would be the list this exists to replace. Each item carries the entity it is read on --
 * the key the scope records it under -- and `always` when the spec reads it whatever is chosen.
 *
 * `kind` is `system` when HubSpot says the property is one of its own (`hubspotDefined: true`),
 * and `user` otherwise. HubSpot documents that flag as the mark of a built-in property, so a
 * property it does not mark is, by HubSpot's own definition, not one of HubSpot's: the portal's.
 *
 * A 401 or 403 raises as an `HttpError` for `browseScope` to turn into `scope-insufficient`: a
 * token whose private app lacks the object's read scope is a reconnect, not an outage.
 */
export async function listProperties(
  deps: PropertiesDeps,
  spec: ConnectorSpec,
): Promise<BrowseItem[]> {
  const items: BrowseItem[] = [];
  for (const entity of spec.entities) {
    const objectType = objectTypeOf(entity);
    if (objectType !== null) {
      const always = new Set(floorOf(entity));
      const rows = await fetchProperties(deps, spec.baseUrl, objectType);
      items.push(...rows.flatMap((row) => itemOf(row, entity.name, always)));
    }
  }
  return items;
}

async function fetchProperties(
  deps: PropertiesDeps,
  baseUrl: string,
  objectType: string,
): Promise<PropertyRow[]> {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const request = {
    url: new URL(`crm/v3/properties/${encodeURIComponent(objectType)}`, base).toString(),
    method: "GET" as const,
    headers: { authorization: `Bearer ${await deps.token()}`, accept: "application/json" },
  };
  const response = await deps.fetcher.send(request);
  raiseForByteStatus(request, response);

  const body: unknown = JSON.parse(new TextDecoder().decode(response.bytes));
  const results = isRecord(body) ? body.results : undefined;
  return Array.isArray(results) ? results.filter(isRecord) : [];
}

/** One row as a choice, or nothing for a row with no name -- there is nothing to record for it. */
function itemOf(row: PropertyRow, entity: string, always: ReadonlySet<string>): BrowseItem[] {
  const id = typeof row.name === "string" ? row.name : "";
  if (id === "") {
    return [];
  }
  const label = typeof row.label === "string" && row.label !== "" ? row.label : id;
  return [
    {
      id,
      name: label,
      kind: row.hubspotDefined === true ? "system" : "user",
      entity,
      ...(always.has(id) ? { always: true } : {}),
    },
  ];
}

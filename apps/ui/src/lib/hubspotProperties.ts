/**
 * The HubSpot objects a connection reads, their names in the reader's language, and the
 * properties the scope picker offers for each.
 *
 * Wordless apart from `describeHubspotObject`, the way `labelIndex.ts` is: this decides what the
 * picker shows and the component gives it words, which is what lets the decisions be proven
 * without rendering a tRPC provider.
 *
 * Nothing here mirrors the spec. Which objects exist and which of their properties are always
 * read both arrive with the listing (`connections.browseScope`), because the worker reads them
 * off `specs/connectors/hubspot.yaml`; a list written here would be a second copy to drift.
 * Only the WORDS for the three objects shipped today live here, and an object this build has no
 * word for keeps its id rather than being dropped.
 */

import type { TFunction } from "i18next";

import type { BrowsedLabel } from "@/lib/labelIndex.ts";

const OBJECT_KEY = {
  companies: "scope.hubspotCompanies",
  contacts: "scope.hubspotContacts",
  deals: "scope.hubspotDeals",
} as const;

function isNamedObject(entity: string): entity is keyof typeof OBJECT_KEY {
  return Object.hasOwn(OBJECT_KEY, entity);
}

/** An object's name for a reader; an id this build has no word for keeps its id. */
export function describeHubspotObject(t: TFunction, entity: string): string {
  return isNamedObject(entity) ? t(OBJECT_KEY[entity]) : entity;
}

/** One item of a browse listing, as far as the scope picker reads it. */
export interface ListedItem {
  readonly id: string;
  readonly name: string;
  readonly kind: string | null;
  readonly entity?: string | undefined;
  readonly always?: boolean | undefined;
}

/** What the picker shows for one object. */
export interface ObjectProperties {
  readonly entity: string;
  /** Read whatever is chosen: the spec's own. Shown as a sentence, never as a tick to undo. */
  readonly always: readonly BrowsedLabel[];
  /**
   * What may be ticked: every property HubSpot listed that is not always read, plus any name the
   * choice holds that HubSpot no longer lists. The last have no owner to report (`kind: null`)
   * and get a run of their own -- shown rather than hidden, because a tick nobody can see is a
   * tick nobody can take back, and the count beneath the list would include it.
   */
  readonly choosable: readonly BrowsedLabel[];
}

/**
 * The listing gathered by object, in the order the worker listed them (the spec's).
 *
 * `chosen` is the draft's per-object choice. An object that holds a choice but that HubSpot
 * listed nothing for is still returned, so its stale ticks can be seen and cleared.
 */
export function propertiesByObject(
  items: readonly ListedItem[],
  chosen: Readonly<Record<string, readonly string[]>>,
): ObjectProperties[] {
  const entities = [
    ...new Set([
      ...items.flatMap((item) => (item.entity === undefined ? [] : [item.entity])),
      ...Object.entries(chosen).flatMap(([entity, names]) => (names.length > 0 ? [entity] : [])),
    ]),
  ];
  return entities.map((entity) => {
    const listed = items.filter(
      (item): item is ListedItem & { kind: "system" | "user" } =>
        item.entity === entity && (item.kind === "system" || item.kind === "user"),
    );
    const known = new Set(listed.map((item) => item.id));
    const gone = (chosen[entity] ?? [])
      .filter((name) => !known.has(name))
      .map((name) => ({ id: name, name, kind: null }));
    return {
      entity,
      always: listed.filter((item) => item.always === true).map(asLabel),
      choosable: [...listed.filter((item) => item.always !== true).map(asLabel), ...gone],
    };
  });
}

function asLabel(item: ListedItem & { kind: "system" | "user" }): BrowsedLabel {
  return { id: item.id, name: item.name, kind: item.kind };
}

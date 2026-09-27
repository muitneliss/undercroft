/**
 * One HubSpot record against the lake's copy of it, and one deal's company links against the
 * lake's. Pure: the live suite turns each answer into one test.
 */

import type { CrmRecord } from "./json.ts";

/** Why one record does or does not match. */
export type Verdict =
  | { readonly kind: "same" }
  | { readonly kind: "missing" }
  | { readonly kind: "different"; readonly properties: readonly string[] }
  | { readonly kind: "stale" }
  | { readonly kind: "pending" }
  | { readonly kind: "ahead" };

function byName(a: string, b: string): number {
  return a.localeCompare(b);
}

/**
 * Versions are compared first, by `updatedAt`; only the same version can be compared value by
 * value.
 *
 * - A HubSpot version newer than the lake's is the next run's work if it changed after the last
 *   run started (`pending`), and a missed change if it changed before (`stale`).
 * - A lake version newer than HubSpot's cannot happen (`ahead`).
 * - At the same version, a property one side has and the other lacks is a difference, and so is
 *   `null` against a value: absent and empty are two states, and the lake must keep which one
 *   HubSpot sent.
 */
export function compare(
  source: CrmRecord,
  lake: CrmRecord | undefined,
  lastRun: string | null,
): Verdict {
  if (lake === undefined) {
    return { kind: "missing" };
  }
  const sourceAt = Date.parse(source.updatedAt);
  const lakeAt = Date.parse(lake.updatedAt);
  if (sourceAt > lakeAt) {
    const afterRun = lastRun !== null && sourceAt >= Date.parse(lastRun);
    return afterRun ? { kind: "pending" } : { kind: "stale" };
  }
  if (sourceAt < lakeAt) {
    return { kind: "ahead" };
  }
  const names = new Set([...Object.keys(source.properties), ...Object.keys(lake.properties)]);
  const differ = [...names].filter(
    (name) =>
      !(Object.hasOwn(source.properties, name) && Object.hasOwn(lake.properties, name)) ||
      source.properties[name] !== lake.properties[name],
  );
  if (source.archived !== lake.archived) {
    differ.push("(archived)");
  }
  return differ.length === 0
    ? { kind: "same" }
    : { kind: "different", properties: differ.sort(byName) };
}

/** The company ids one side links a deal to and the other does not. */
export function compareLinks(
  source: ReadonlySet<string>,
  lake: ReadonlySet<string>,
): { missing: string[]; extra: string[] } {
  return {
    missing: [...source].filter((id) => !lake.has(id)).sort(byName),
    extra: [...lake].filter((id) => !source.has(id)).sort(byName),
  };
}

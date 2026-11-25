/**
 * A record's canonical text, with the arrays its spec declares unordered put in one order first.
 * ADR 0158.
 *
 * `canonicalJson` sorts object keys and leaves arrays alone, and it is right to: an array's order
 * is usually something the source said. Some sources answer a SET as an array and shuffle it
 * between calls -- HubSpot's v4 association batch read does, to `to[].associationTypes` -- and
 * then the same record hashes two ways, so the lake keeps a "changed" version on every sync. An
 * entity's `unorderedArrays` says which arrays are sets, and only those are reordered here.
 *
 * The sorted form is what is STORED, not only what is hashed. The lake addresses a payload by the
 * digest of its bytes (`raw-lake.md`), and a digest of one form over bytes of another would break
 * the one property that makes re-observing a record free -- and would need `LakeStore` to know
 * about a spec, which a single create-only writer must not. The order dropped is one the spec has
 * declared meaningless, exactly as key order already is.
 *
 * Exported for the same reason it is one function: whatever re-canonicalises a payload already in
 * the lake must produce the bytes a read would land today, or the two would disagree about what
 * "the same record" is.
 */

import { canonicalJson } from "@undercroft/core";

/** One step of a declared path: a field, and whether to step into each element of it. */
interface Step {
  readonly name: string;
  readonly each: boolean;
}

/** `typeof x === "object"` still admits null and arrays. This does not. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `to[].associationTypes` as steps; the grammar is `UnorderedArrayPath` in the spec. */
function stepsOf(path: string): Step[] {
  return path
    .split(".")
    .map((part) =>
      part.endsWith("[]") ? { name: part.slice(0, -2), each: true } : { name: part, each: false },
    );
}

/**
 * The elements in the order of their canonical text. That text is ASCII by construction, so
 * comparing it by code unit is comparing it by code point: one order on every machine.
 */
function sortedSet(elements: readonly unknown[]): unknown[] {
  return elements
    .map((element) => ({ key: canonicalJson(element), element }))
    .toSorted((a, b) => {
      if (a.key === b.key) {
        return 0;
      }
      return a.key < b.key ? -1 : 1;
    })
    .map(({ element }) => element);
}

/**
 * `node` with the array `steps` reaches sorted, sharing everything it does not touch.
 *
 * A path that does not reach an array -- the field is absent, `null`, or not an array on this
 * record -- leaves the node exactly as the source sent it. Nothing is guessed either way: the
 * payload still says what the source said, and there was no set there to put in order.
 */
function ordered(node: unknown, steps: readonly Step[]): unknown {
  const [head, ...rest] = steps;
  if (head === undefined) {
    return Array.isArray(node) ? sortedSet(node) : node;
  }
  if (!(isRecord(node) && Object.hasOwn(node, head.name))) {
    return node;
  }
  const child = node[head.name];
  if (!head.each) {
    return { ...node, [head.name]: ordered(child, rest) };
  }
  return Array.isArray(child)
    ? { ...node, [head.name]: child.map((element) => ordered(element, rest)) }
    : node;
}

/**
 * The canonical text of a lossless-parsed payload, every array at `unorderedArrays` sorted.
 *
 * Deepest path first, so a set of sets -- `to`, whose links each hold `associationTypes` -- is
 * sorted by elements that are already in their one order. With no paths it is `canonicalJson`.
 */
export function canonicalPayload(payload: unknown, unorderedArrays: readonly string[]): string {
  const deepestFirst = unorderedArrays.map(stepsOf).toSorted((a, b) => b.length - a.length);
  return canonicalJson(deepestFirst.reduce(ordered, payload));
}

/**
 * Reading a value out of a decoded payload, by path.
 *
 * Connector specs say `paging.next.link` or `results` or `from.id`, and something has to
 * turn that into a lookup. That something is deliberately **not** a JSONPath library.
 *
 * General JSONPath brings filter expressions -- `$..[?(@.price > 10)]` -- which means an
 * expression evaluator running over third-party API responses. We have no use for it,
 * and the implementations that offer it have a history of doing so via mechanisms nobody
 * wants in that position. A dotted path with numeric indices covers every real connector,
 * so that is all this supports.
 */

import { isLosslessNumber } from "lossless-json";

/**
 * Keys that would reach the prototype chain rather than the payload.
 *
 * A source cannot exploit this to *write* anything, since we only read -- but a spec
 * pointing at `constructor.prototype` would silently return a function where the caller
 * expected a record id, and "silently returns the wrong kind of thing" is how a guessed
 * value gets into the lake.
 */
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

export function parsePath(path: string): string[] {
  if (path === "") {
    return [];
  }
  const segments: string[] = [];
  for (const part of path.split(".")) {
    const match = /^([^[\]]*)((?:\[\d+\])*)$/u.exec(part);
    if (match === null) {
      throw new TypeError(`unreadable path segment ${JSON.stringify(part)}`);
    }
    const [, name = "", indices = ""] = match;
    if (name !== "") {
      segments.push(name);
    }
    for (const index of indices.matchAll(/\[(\d+)\]/gu)) {
      segments.push(index[1]!);
    }
  }
  return segments;
}

/** Read `path` out of `root`, or `undefined` if any step is missing. Never throws on a miss. */
export function getPath(root: unknown, path: string): unknown {
  let current = root;
  for (const segment of parsePath(path)) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (FORBIDDEN.has(segment)) {
      return undefined;
    }
    if (Array.isArray(current)) {
      const index = Number.parseInt(segment, 10);
      if (Number.isNaN(index)) {
        return undefined;
      }
      current = current[index];
      continue;
    }
    if (typeof current !== "object") {
      return undefined;
    }
    if (!Object.hasOwn(current, segment)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Read a path that must be a non-empty string -- a record id, a next link.
 *
 * Returns `null` rather than coercing. A record id that arrived as a number is returned
 * as its digits, because that is lossless for an identifier; anything else is a miss.
 */
export function getStringPath(root: unknown, path: string): string | null {
  const value = getPath(root, path);
  if (typeof value === "string") {
    return value === "" ? null : value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  // A number that arrived through `lossless-json` keeps its digits as a string; return
  // them rather than coercing to a `number` and losing anything past a double.
  if (isLosslessNumber(value)) {
    return value.toString();
  }
  return null;
}

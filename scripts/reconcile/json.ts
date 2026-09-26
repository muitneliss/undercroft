/**
 * Narrowing parsed JSON. Every system this suite reads answers in JSON it does not control, so
 * a shape it did not expect is an error that names the shape, never a cast that lets a wrong
 * field read as `undefined` and a record quietly drop out of a comparison.
 */

import { ReconcileError } from "./errors.ts";

export function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ReconcileError(`expected an object, got ${preview(value)}`, { code: "SHAPE" });
  }
  return Object.fromEntries(Object.entries(value));
}

export function asArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new ReconcileError(`expected an array, got ${preview(value)}`, { code: "SHAPE" });
  }
  return value;
}

/** An optional object field: absent and null read as empty, anything else must be an object. */
export function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value === undefined || value === null ? {} : asObject(value);
}

/** An optional array field: absent and null read as empty. */
export function arrayOrEmpty(value: unknown): readonly unknown[] {
  return value === undefined || value === null ? [] : asArray(value);
}

/** A scalar as text; absent and null read as the empty string. */
export function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

/** A count the systems send as a number or as a decimal string. */
export function count(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  return typeof value === "string" ? Number.parseInt(value, 10) : 0;
}

/** A string field, or null when absent or not a string. */
export function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function preview(value: unknown): string {
  return (JSON.stringify(value) ?? String(value)).slice(0, 80);
}

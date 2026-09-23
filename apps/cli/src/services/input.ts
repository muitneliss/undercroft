/**
 * A procedure's input, assembled from what a person or an agent typed.
 *
 * The schema is the router's own (`manifest.ts`), so the flags are not a second description
 * of the input -- they are the top-level scalar properties of it, named mechanically:
 * `tenantId` is `--tenant-id`, an enum is a flag that accepts exactly its values, and a
 * boolean is `--x` / `--no-x`. Anything nested -- a model's SQL body is a scalar, but a
 * dashboard or a scope `selection` is not -- arrives as JSON through `--input -` (stdin),
 * `--input <file>` or `--input-json`.
 *
 * When several are given they merge property by property, and the most specific wins:
 * a typed flag, then the `--input` document, then `--input-json`. That lets an agent keep a
 * large body in a file and override one field on the command line.
 *
 * The SERVER is the validator. `checkShape` exists for `--dry-run`, which by definition asks
 * no server, and it checks only what a JSON Schema states plainly -- presence, type, enum,
 * bounds. It is not a second copy of zod's rules; a dry run that passes here can still be
 * refused by the server, and the contract says so.
 */

import { type JsonSchema, kebab } from "../manifest.ts";
import { isRecord } from "./store.ts";

export type FlagKind = "string" | "integer" | "boolean" | "enum";

export interface FlagSpec {
  /** The flag as typed, without the dashes: `tenant-id`. */
  readonly flag: string;
  /** The property it fills: `tenantId`. */
  readonly property: string;
  readonly kind: FlagKind;
  readonly options: readonly string[];
}

function typeOf(schema: JsonSchema): string | undefined {
  return typeof schema.type === "string" ? schema.type : undefined;
}

function kindOf(schema: JsonSchema): FlagKind | null {
  if (schema.enum?.every((value) => typeof value === "string") === true) {
    return "enum";
  }
  switch (typeOf(schema)) {
    case "string":
      return "string";
    case "integer":
      return "integer";
    case "boolean":
      return "boolean";
    default:
      // A non-integer `number` gets no typed flag on purpose: turning argv text into a
      // float is the coercion `money.md` bans, and it would be the one place a value from
      // the command line became a float the CLI chose. JSON input carries it unchanged.
      return null;
  }
}

/** The typed flags a procedure's input offers, in the schema's own property order. */
export function flagSpecs(schema: JsonSchema): FlagSpec[] {
  return Object.entries(schema.properties ?? {}).flatMap(([property, value]) => {
    const kind = kindOf(value);
    if (kind === null) {
      return [];
    }
    const options = kind === "enum" ? (value.enum ?? []).filter((v) => typeof v === "string") : [];
    return [{ flag: kebab(property), property, kind, options }];
  });
}

export type Merged =
  | { readonly ok: true; readonly value: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly source: string };

/**
 * Merge the three sources, most specific last so it wins.
 *
 * A source that is not a JSON object is refused rather than ignored: `--input-json 42` is a
 * mistake, and dropping it would send a request that silently lacks what was meant.
 */
export function mergeInput(sources: {
  readonly typed: Readonly<Record<string, unknown>>;
  readonly document: { readonly source: string; readonly text: string } | null;
  readonly inline: string | null;
}): Merged {
  const layers: Readonly<Record<string, unknown>>[] = [];
  for (const [source, text] of [
    ["--input-json", sources.inline],
    [sources.document?.source ?? "--input", sources.document?.text ?? null],
  ] as const) {
    if (text === null) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, source };
    }
    if (!isRecord(parsed)) {
      return { ok: false, source };
    }
    layers.push(parsed);
  }
  return { ok: true, value: Object.assign({}, ...layers, sources.typed) };
}

/** The required properties the input does not have. The caller words them as flags. */
export function missingRequired(
  schema: JsonSchema,
  value: Readonly<Record<string, unknown>>,
): string[] {
  return (schema.required ?? []).filter((property) => value[property] === undefined);
}

function typeMatches(type: string, value: unknown): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "integer":
      return Number.isInteger(value);
    case "number":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return isRecord(value);
    case "null":
      return value === null;
    default:
      return true;
  }
}

function boundsIssue(schema: JsonSchema, value: unknown): string | null {
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      return `minimum ${String(schema.minimum)}`;
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      return `maximum ${String(schema.maximum)}`;
    }
  }
  const length = typeof value === "string" || Array.isArray(value) ? value.length : null;
  const [min, max] =
    typeof value === "string"
      ? [schema.minLength, schema.maxLength]
      : [schema.minItems, schema.maxItems];
  if (length !== null && min !== undefined && length < min) {
    return `at least ${String(min)} long`;
  }
  if (length !== null && max !== undefined && length > max) {
    return `at most ${String(max)} long`;
  }
  return null;
}

/**
 * What a JSON Schema says plainly that this value breaks, as `path: reason` lines.
 *
 * Empty is not "valid" -- it is "nothing this check can see is wrong". An `anyOf` is not
 * descended, because choosing which branch a value was meant for is a guess.
 */
export function checkShape(schema: JsonSchema, value: unknown, path = "input"): string[] {
  const type = typeOf(schema);
  if (type !== undefined && !typeMatches(type, value)) {
    return [`${path}: expected ${type}`];
  }
  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    return [`${path}: expected one of ${JSON.stringify(schema.enum)}`];
  }
  const bounds = boundsIssue(schema, value);
  if (bounds !== null) {
    return [`${path}: ${bounds}`];
  }
  if (isRecord(value)) {
    const missing = missingRequired(schema, value).map((name) => `${path}.${name}: required`);
    const nested = Object.entries(schema.properties ?? {}).flatMap(([name, child]) =>
      value[name] === undefined ? [] : checkShape(child, value[name], `${path}.${name}`),
    );
    return [...missing, ...nested];
  }
  if (Array.isArray(value) && schema.items !== undefined) {
    const { items } = schema;
    return value.flatMap((item, index) => checkShape(items, item, `${path}[${String(index)}]`));
  }
  return [];
}

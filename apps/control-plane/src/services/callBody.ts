/**
 * What a kept call's request and answer become in `ops.call_log` (ADR 0151): JSON text, with no
 * secret in it, no cell of a customer's data where the answer is kept as its shape, and no more
 * than {@link PAYLOAD_CAP_BYTES} of it.
 *
 * Two functions, one per body, because the rules differ only in what the answer may keep. Both
 * are pure and neither throws: a value JSON cannot write -- a getter that throws, a proxy -- is
 * stored as `[unserialisable]`, never lost silently and never fatal to the call.
 *
 * - **No secret.** A key on {@link SECRET_KEYS} is `[redacted]` wherever it sits; so are the
 *   top-level fields a procedure's own entry names (`handlers/callPayload.ts`), which are typed
 *   against the router, so a renamed secret field is a `tsc` error, not a leak.
 * - **No cell where the answer is a shape.** {@link SHAPE_KEPT} and {@link SHAPE_COUNTED} are an
 *   ALLOW-list: a key in neither is dropped and named in `omitted`, so a field added to an answer
 *   tomorrow is dropped until somebody vouches that it holds no cell -- never a deny-list of data
 *   keys, which the first new field would walk past. ADR 0026 section 3.
 * - **Bounded.** Cut on a UTF-8 character boundary, with the whole size and a flag.
 */

import type { ResponseKept, StoredBody } from "../repos/callLog.ts";

/** The most of a request, or of an answer, a row holds. ADR 0151. */
export const PAYLOAD_CAP_BYTES = 256 * 1024;

/** What stands where a secret was. */
export const REDACTED = "[redacted]";

/** What stands for a body that could not be written as JSON at all. */
const UNSERIALISABLE = "[unserialisable]";

/**
 * Keys whose value is a credential wherever they appear, compared lowercased and exactly: a
 * pasted token, a minted one, an OAuth exchange's parts. Exact, because `tokenId` or `tokens`
 * (a list of ids) are facts a superadmin debugging a call needs, and a substring match would
 * blank them.
 */
const SECRET_KEYS: ReadonlySet<string> = new Set([
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "secret",
  "clientsecret",
  "password",
  "apikey",
  "authorization",
  "code_verifier",
  "codeverifier",
]);

/**
 * The keys of an answer kept as its shape whose values are notes ABOUT the answer -- whether it
 * was cut, the next page, what the tables' tests say, which rows were limited, a seed's name and
 * hash -- and never a cell. Kept as they are. Everything an answer kept as a shape may say is in
 * this list or the two below; a key in none of them is dropped and named in `omitted`.
 */
const SHAPE_KEPT: ReadonlySet<string> = new Set([
  "truncated",
  "nextCursor",
  "capped",
  "partial",
  "ofRun",
  "qualifiers",
  "rowsLimited",
  "rowsWithheld",
  "compiled",
  "name",
  "columnCount",
  "rowCount",
  "sha256",
  "updatedAt",
]);

/** The keys that hold the data itself: kept as how many there were. */
const SHAPE_COUNTED: ReadonlySet<string> = new Set(["rows", "items", "hits"]);

/** The one key kept projected: each column's name and type, which name the data and hold none. */
const SHAPE_COLUMNS = "columns";

/** A value as JSON can hold it. */
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** What a door saw of a call that did not succeed, worded server-side; the wire says less. */
export interface CallError {
  readonly code: string;
  readonly status: number;
  readonly message: string;
  readonly facts: Readonly<Record<string, string | null>> | null;
  /** The exception underneath, when there was one: what the caller was told was `internal_error`. */
  readonly cause: {
    readonly name: string;
    readonly message: string;
    readonly stack: string | null;
  } | null;
}

/**
 * The most of an error's message, or of its cause's message or stack, a row holds. A cause's text
 * is the one part of an error that can be long -- a stack, a driver's sentence quoting a row -- and
 * the error is kept whole beside a request and an answer that are already capped.
 */
export const ERROR_TEXT_CAP_BYTES = 16 * 1024;

/**
 * The error as a row stores it, as JSON: its texts cut to {@link ERROR_TEXT_CAP_BYTES} each, and
 * its facts through the same secret-key deny-list as a body, since a refusal's facts are whatever
 * the code that refused chose to name.
 */
export function storedError(error: CallError): string {
  const { cause } = error;
  return JSON.stringify({
    code: error.code,
    status: error.status,
    message: cut(error.message, ERROR_TEXT_CAP_BYTES).text,
    facts: error.facts === null ? null : (jsonOf(error.facts) ?? null),
    cause:
      cause === null
        ? null
        : {
            name: cause.name,
            message: cut(cause.message, ERROR_TEXT_CAP_BYTES).text,
            stack: cause.stack === null ? null : cut(cause.stack, ERROR_TEXT_CAP_BYTES).text,
          },
  });
}

/** The request as a row stores it, with `fields` -- top-level input fields -- redacted. */
export function storedRequest(value: unknown, fields: readonly string[]): StoredBody | null {
  return bodyOf(() => redactFields(jsonOf(value), fields));
}

/**
 * The answer as a row stores it, `kept` whole or as its shape, with `fields` -- top-level answer
 * fields -- redacted; `null` for an answer kept as `none` or never given.
 */
export function storedResponse(
  value: unknown,
  kept: ResponseKept,
  fields: readonly string[],
): StoredBody | null {
  if (value === undefined || kept === "none") {
    return null;
  }
  return bodyOf(() => {
    const whole = redactFields(jsonOf(value), fields);
    return kept === "shape" ? shapeOf(whole) : whole;
  });
}

/** A body as stored: serialised, cut at the cap, or the marker when it could not be serialised. */
function bodyOf(tree: () => Json | undefined): StoredBody | null {
  let text: string;
  try {
    const value = tree();
    if (value === undefined) {
      return null;
    }
    text = JSON.stringify(value);
  } catch {
    text = UNSERIALISABLE;
  }
  return cut(text);
}

/** `text` cut to `cap` bytes at a character's start, never inside one's UTF-8 bytes. */
function cut(text: string, cap: number = PAYLOAD_CAP_BYTES): StoredBody {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= cap) {
    return { text, bytes: bytes.length, truncated: false };
  }
  let end = cap;
  // A continuation byte is 10xxxxxx, 0x80 to 0xbf; back up to the byte that starts its character.
  while (end > 0 && isContinuation(bytes[end])) {
    end -= 1;
  }
  return {
    text: new TextDecoder().decode(bytes.subarray(0, end)),
    bytes: bytes.length,
    truncated: true,
  };
}

function isContinuation(byte: number | undefined): boolean {
  return byte !== undefined && byte >= 0x80 && byte < 0xc0;
}

/**
 * `value` as JSON would write it, with what `JSON.stringify` refuses made writable: a bigint as
 * its digits, a cycle as `[circular]`. `undefined` for a value JSON leaves out entirely.
 */
function jsonOf(value: unknown, ancestors: readonly object[] = []): Json | undefined {
  if (value === null) {
    return null;
  }
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      return Number.isFinite(value) ? value : null;
    case "bigint":
      return value.toString();
    case "object":
      return objectJson(value, ancestors);
    default:
      // undefined, a function, a symbol: what JSON leaves out.
      return undefined;
  }
}

function objectJson(value: object, ancestors: readonly object[]): Json {
  if (ancestors.includes(value)) {
    return "[circular]";
  }
  const toJson: unknown = Reflect.get(value, "toJSON");
  if (typeof toJson === "function") {
    return jsonOf(Reflect.apply(toJson, value, []), ancestors) ?? null;
  }
  const inside = [...ancestors, value];
  if (Array.isArray(value)) {
    return value.map((item: unknown) => jsonOf(item, inside) ?? null);
  }
  const out: { [key: string]: Json } = {};
  for (const [key, item] of Object.entries(value)) {
    const json = jsonOf(item, inside);
    if (json !== undefined) {
      out[key] = SECRET_KEYS.has(key.toLowerCase()) ? REDACTED : json;
    }
  }
  return out;
}

/** `tree` with each named top-level field, where present, replaced by {@link REDACTED}. */
function redactFields(tree: Json | undefined, fields: readonly string[]): Json | undefined {
  if (fields.length === 0 || !isObject(tree)) {
    return tree;
  }
  const out = { ...tree };
  for (const field of fields) {
    if (Object.hasOwn(out, field)) {
      out[field] = REDACTED;
    }
  }
  return out;
}

/** An answer as its shape: see {@link SHAPE_KEPT}. A list answered alone is how long it was. */
function shapeOf(tree: Json | undefined): Json | undefined {
  if (tree === undefined || tree === null) {
    return tree;
  }
  if (Array.isArray(tree)) {
    return { count: tree.length };
  }
  if (!isObject(tree)) {
    // A bare value is a cell as surely as one in a row; its kind is what may be said of it.
    return { kind: typeof tree };
  }
  const shape: { [key: string]: Json } = {};
  const omitted: string[] = [];
  for (const [key, value] of Object.entries(tree)) {
    if (SHAPE_KEPT.has(key)) {
      shape[key] = value;
    } else if (SHAPE_COUNTED.has(key) && Array.isArray(value)) {
      shape[key] = { count: value.length };
    } else if (key === SHAPE_COLUMNS && Array.isArray(value)) {
      shape[key] = value.map(columnOf);
    } else {
      omitted.push(key);
    }
  }
  if (omitted.length > 0) {
    shape.omitted = omitted;
  }
  return shape;
}

/** A column as a shape keeps it: its name and type, when they are text, and nothing else. */
function columnOf(column: Json): Json {
  if (!isObject(column)) {
    return null;
  }
  const { name, type } = column;
  return {
    name: typeof name === "string" ? name : null,
    type: typeof type === "string" ? type : null,
  };
}

function isObject(value: Json | undefined): value is { [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Canonical JSON, for content addressing.
 *
 * The lake is addressed by the SHA-256 of a payload's bytes, so "the same payload"
 * must produce the same bytes every time or content-idempotence silently stops working:
 * every run reports `created`, every observation writes a new manifest, and an hourly
 * schedule pushes real history out through retention using nothing but copies of the
 * same record.
 *
 * `JSON.stringify` cannot do this job, for two independent reasons.
 *
 * **It does not order keys.** Object key order in JavaScript follows insertion order,
 * which follows whatever order the source API happened to serialise in. A provider that
 * reorders two fields would look like a changed record.
 *
 * **`JSON.parse` has already destroyed the numbers.** Every number becomes an IEEE
 * double at parse time, and JavaScript offers no `parse_float` hook to intercept it --
 * so a 25-digit identifier or an invoice total with sub-cent precision is lost before
 * the first line of our code runs. RFC 8785 (JCS) does not help either: it fixes
 * ordering and separators but then serialises numbers by ECMAScript double rules,
 * pulling the same defect into the hash itself.
 *
 * So: parse with `lossless-json`, which keeps every number as its original digit
 * string, and emit with keys sorted by code point, no whitespace, and non-ASCII escaped.
 *
 * ## Numbers are emitted verbatim, and that is deliberate
 *
 * `1.50` is not rewritten to `1.5`. Normalising would give more stable hashes when a
 * provider changes its representation, but these bytes are *the archive* -- the thing
 * that cannot be recomputed. An archive that quietly rewrites what the source said is
 * not an archive. If a provider starts sending `1.5` where it sent `1.50`, that is a
 * real observation about the provider, and recording it is the correct outcome.
 */

import { isLosslessNumber, parse as losslessParse } from "lossless-json";

const SHORT_ESCAPES: Readonly<Record<string, string>> = {
  '"': '\\"',
  "\\": "\\\\",
  "\b": "\\b",
  "\f": "\\f",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
};

function hex4(code: number): string {
  return `\\u${code.toString(16).padStart(4, "0")}`;
}

/**
 * Escape a string, ASCII-only.
 *
 * Everything outside printable ASCII becomes `\uXXXX`, with non-BMP code points written
 * as a surrogate pair. Restricting the output to ASCII means the bytes are the same
 * whatever encoding assumption a reader makes, which is one fewer way for a digest to
 * disagree with itself across systems.
 */
function escapeString(value: string): string {
  let out = '"';
  for (const char of value) {
    const short = SHORT_ESCAPES[char];
    if (short !== undefined) {
      out += short;
      continue;
    }
    const code = char.codePointAt(0)!;
    if (code < 0x20 || code > 0x7e) {
      if (code > 0xff_ff) {
        const offset = code - 0x1_00_00;
        out += hex4(0xd8_00 + (offset >> 10)) + hex4(0xdc_00 + (offset & 0x3_ff));
      } else {
        out += hex4(code);
      }
    } else {
      out += char;
    }
  }
  return `${out}"`;
}

/**
 * Sort by Unicode code point, not by UTF-16 code unit.
 *
 * JavaScript's default string comparison orders by code unit, which puts some non-BMP
 * characters before BMP ones that should sort after them. Rare, but a sort order that is
 * *usually* right is the worst kind for a hash: it works until the day a key contains an
 * emoji, and then one record hashes differently on two machines for no visible reason.
 */
function byCodePoint(a: string, b: string): number {
  const left = [...a];
  const right = [...b];
  const shared = Math.min(left.length, right.length);
  for (let i = 0; i < shared; i += 1) {
    const diff = left[i]!.codePointAt(0)! - right[i]!.codePointAt(0)!;
    if (diff !== 0) {
      return diff;
    }
  }
  return left.length - right.length;
}

function serialise(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "string") {
    return escapeString(value);
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (isLosslessNumber(value)) {
    return value.toString();
  }

  if (typeof value === "number") {
    // Reachable only if a caller parsed with `JSON.parse` instead of `losslessParse`.
    // By this point the digits are already gone, so hashing it would mint a content
    // address for a value the source never sent.
    throw new TypeError(
      "refusing to canonicalise a JavaScript number: it is a float, so any precision " +
        "beyond a double is already lost. Parse the payload with canonicalJsonFromText() " +
        "or lossless-json, or pass a bigint.",
    );
  }

  if (Array.isArray(value)) {
    return `[${value.map(serialise).join(",")}]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => byCodePoint(a, b));
    return `{${entries.map(([k, v]) => `${escapeString(k)}:${serialise(v)}`).join(",")}}`;
  }

  throw new TypeError(`refusing to canonicalise a ${typeof value}`);
}

/** Canonicalise an already-parsed tree. Numbers must be `LosslessNumber` or `bigint`. */
export function canonicalJson(value: unknown): string {
  return serialise(value);
}

/** Parse JSON text losslessly and canonicalise it. This is the usual entry point. */
export function canonicalJsonFromText(text: string): string {
  return serialise(losslessParse(text));
}

/** Parse JSON text losslessly, leaving numbers as `LosslessNumber`. */
export function parseLossless(text: string): unknown {
  return losslessParse(text);
}

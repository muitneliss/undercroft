/**
 * What a BIFF8 cell holds, as the string an `.xlsx` would have stored for it. ADR 0104
 * decision 7, and the one place in the platform a `number` holds what may be money.
 *
 * A BIFF8 workbook stores a number as an IEEE-754 double (`NUMBER`, a formula's result), or as
 * an `RK`: thirty bits of an integer or of a double, optionally ×1/100. The double IS the file's
 * value -- Excel wrote it, the platform did not create it -- so it is rendered ONCE, to the
 * shortest decimal that reads back as exactly that double (ECMAScript `Number::toString`), which
 * is the digits an `.xlsx` stores for the same cell. Nothing computes with it.
 *
 * An RK's ×1/100 is never a float division, which rounds a second time: the double
 * 1.0141639709472656 divided by 100 prints `0.010141639709472657`, one digit from the value the
 * file holds. The rendered digits are shifted two places instead, as text. `money.md`'s rule is
 * that a float never carries an amount through arithmetic; here no arithmetic happens at all.
 */

import { parseAmount } from "@undercroft/core/money";

const RK_HUNDREDTHS = 0x01;
const RK_INTEGER = 0x02;
const RK_VALUE_MASK = 0xff_ff_ff_fc;
const DOUBLE_BYTES = 8;
const TRAILING_ZEROS = /0+$/u;
const LEADING_ZEROS = /^0+(?=\d)/u;

/** The error codes of `BOOLERR` and a formula's error result, as Excel shows them (§2.5.97). */
const ERRORS: ReadonlyMap<number, string> = new Map([
  [0x00, "#NULL!"],
  [0x07, "#DIV/0!"],
  [0x0f, "#VALUE!"],
  [0x17, "#REF!"],
  [0x1d, "#NAME?"],
  [0x24, "#NUM!"],
  [0x2a, "#N/A"],
  [0x2b, "#GETTING_DATA"],
]);

/** An error code as Excel shows it; an unknown one by its number, never dropped. */
export function errorOf(code: number): string {
  return ERRORS.get(code) ?? `#ERROR(${String(code)})`;
}

/** A double, read from eight little-endian bytes, rendered once. */
export function doubleText(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, DOUBLE_BYTES);
  // The file's own value, rendered to its shortest exact decimal; see the module docstring.
  return String(view.getFloat64(0, true));
}

/** `-0` is not a different number, and an `.xlsx` would store `0`. */
function plain(text: string): string {
  return text === "-0" ? "0" : text;
}

/**
 * The digits of `text` divided by 100, exactly, by moving the decimal point. `parseAmount`
 * gives the value in plain notation first, so an exponent (`1e-7`) is shifted correctly too.
 */
function hundredth(text: string): string {
  const exact = parseAmount(text)?.toFixed() ?? text;
  const negative = exact.startsWith("-");
  const [whole = "", fraction = ""] = (negative ? exact.slice(1) : exact).split(".");
  const padded = whole.padStart(3, "0");
  const integer = padded.slice(0, -2).replace(LEADING_ZEROS, "");
  const decimals = `${padded.slice(-2)}${fraction}`.replace(TRAILING_ZEROS, "");
  const shifted = `${negative ? "-" : ""}${integer}${decimals === "" ? "" : `.${decimals}`}`;
  return plain(shifted);
}

/** An `RK` value (§2.5.217): a 30-bit integer or the high 30 bits of a double, maybe ×1/100. */
export function rkText(rk: number): string {
  let text: string;
  if ((rk & RK_INTEGER) === 0) {
    const bytes = new Uint8Array(DOUBLE_BYTES);
    new DataView(bytes.buffer).setUint32(4, (rk & RK_VALUE_MASK) >>> 0, true);
    text = doubleText(bytes);
  } else {
    // Arithmetic shift keeps the sign of the 30-bit integer.
    text = String((rk | 0) >> 2);
  }
  return (rk & RK_HUNDREDTHS) === 0 ? plain(text) : hundredth(text);
}

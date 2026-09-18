/**
 * Fixed-precision money.
 *
 * Two rules govern this module, and both were learned the expensive way.
 *
 * **Never float.** A revenue mart that parses amounts with `Number(value ?? 0)` and
 * accumulates in float has already put every figure a human sees through binary
 * floating point. JavaScript makes this harder to avoid than most languages: `number`
 * IS a double, and there is no built-in decimal to reach for instead.
 *
 * **Never guess.** An amount that cannot be read returns `null` and the caller records
 * why. It does not become `0`. A zero is indistinguishable from a real zero downstream,
 * so a parse failure that returns zero is silent data loss that looks like a fact.
 *
 * Currency is never implicit. Two amounts in different currencies are not comparable
 * without an explicit, dated rate. Refusing to compare is a correct answer; guessing is
 * not.
 *
 * ## Why `big.js` and not `decimal.js`
 *
 * `new Big("oops")` throws. `new Decimal("oops")` returns `NaN`, which propagates
 * silently through arithmetic and prints as a value. The whole point of this module is
 * that an unreadable amount produces nothing rather than something wrong, and a library
 * whose failure mode is a quiet sentinel fights that on every line. `big.js` also
 * defaults to ROUND_HALF_UP and serialises to digits rather than an internal object,
 * so an accidental `JSON.stringify` yields a number-shaped string, never a float.
 */

import Big from "big.js";

/**
 * Storage scale. Matches `NUMERIC(18, 4)`.
 *
 * Four places, not two: FX conversion and unit pricing both produce sub-cent
 * intermediates, and rounding those to 2dp before aggregation is how a ledger drifts by
 * a few cents a month and nobody can say where it went. Presentation rounds to 2;
 * storage keeps 4.
 */
export const SCALE_DP = 4;

// Applies process-wide. `roundHalfUp` is what customers and auditors expect: .5 rounds
// away from zero. Banker's rounding is correct for statistics and wrong for invoices.
Big.DP = SCALE_DP;
Big.RM = Big.roundHalfUp;

// Never render in exponential notation. By default `toString()` switches to
// `1.234e+24` past 21 digits, which is exact but is not what a `numeric` column, a
// JSON payload or a person expects -- and a lake payload that changes shape at a
// magnitude threshold is a difference nobody will predict. Pinned to the extremes so
// the digit string is always the digit string.
Big.PE = 1e6;
Big.NE = -1e6;

/**
 * European decimal notation: "1.234,00" means one thousand two hundred thirty-four.
 * Read as US notation it becomes 1.234, off by a factor of a thousand. We refuse rather
 * than pick, because both readings are plausible and only the source system knows which
 * it meant.
 */
const EURO_NOTATION = /\.\d{3},/u;
const CLEANUP = /[\s'_]/gu;
const ISO_4217 = /^[A-Z]{3}$/u;

/** What a person sees where there is no value. Never an empty cell, never `0`. */
export const MISSING = "—";

/**
 * Three-valued comparison result.
 *
 * Boolean verdicts are the trap: they force "no evidence" into either the pass or the
 * fail bucket. If it lands in pass, the check becomes false reassurance -- worse than
 * having no check, because it is trusted.
 */
export type Verdict = "ok" | "mismatch" | "unverified";

/** An ISO 4217 alpha-3 code. Branded so an arbitrary string cannot be passed as one. */
export type Iso4217 = string & { readonly __iso4217: unique symbol };

/**
 * Digits, as a string.
 *
 * Branded so that `+money.amount` and `money.amount * qty` are compile errors rather
 * than review findings. Arithmetic goes through `add`/`sub`, or through `toBig()` for
 * anything else.
 */
export type Amount = string & { readonly __amount: unique symbol };

/** An amount and its currency. Immutable, exact, never implicitly converted. */
export interface Money {
  readonly amount: Amount;
  readonly currency: Iso4217;
}

export function isIso4217(value: string): value is Iso4217 {
  return ISO_4217.test(value);
}

export function currency(code: string): Iso4217 {
  if (!isIso4217(code)) {
    throw new TypeError(`currency must be an ISO 4217 alpha-3 code, got ${JSON.stringify(code)}`);
  }
  return code;
}

/**
 * Read an amount exactly, or return `null`.
 *
 * Accepts `Big`, `bigint`, and strings with thousands separators or a currency symbol.
 * Rejects `number` outright -- and does so **at runtime as well as in the type**,
 * because TypeScript's types are gone by then and an untyped caller (a JSON payload, a
 * JavaScript consumer, a stray `as`) is genuinely reachable. By the time a `number`
 * arrives the precision loss has already happened; accepting it here would launder a
 * defect into everything downstream.
 */
export function parseAmount(value: string | Big | bigint | null | undefined): Big | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (value instanceof Big) {
    return value;
  }
  if (typeof value === "bigint") {
    return new Big(value.toString());
  }

  if (typeof value === "number") {
    throw new TypeError(
      "refusing to parse a number into money: JavaScript's number is a float, so the " +
        "precision loss already happened upstream. Pass the original string.",
    );
  }
  if (typeof value === "boolean") {
    // Guarded explicitly: `true` would otherwise stringify to "true" and fall
    // through to the Big constructor, and a coerced 1 is a fabricated amount.
    return null;
  }
  if (typeof value !== "string") {
    return null;
  }

  let text = value.replace(CLEANUP, "");
  if (EURO_NOTATION.test(text)) {
    return null;
  }

  text = text.replace(/,/gu, "");
  // Strip a leading currency symbol and a trailing code; keep sign and digits.
  text = text.replace(/^[^\d\-+.]+/u, "");
  if (!/\d$/u.test(text)) {
    text = text.replace(/[^\d]+$/u, "");
  }
  if (text === "" || text === "-" || text === "+" || text === ".") {
    return null;
  }
  // `Decimal("+42")` is legal in Python; `new Big("+42")` throws. An explicit plus
  // is a sign, not a defect, so strip it rather than refusing the amount.
  if (text.startsWith("+")) {
    text = text.slice(1);
  }

  try {
    return new Big(text);
  } catch {
    return null;
  }
}

/** Build a `Money`, or `null` if there was no amount to build it from. */
export function money(amount: Big | null, code: Iso4217): Money | null {
  if (amount === null) {
    return null;
  }
  return { amount: amount.toFixed(SCALE_DP) as Amount, currency: code };
}

export function toBig(value: Money | Amount): Big {
  return new Big(typeof value === "string" ? value : value.amount);
}

function assertSameCurrency(a: Money, b: Money, verb: string): void {
  if (a.currency !== b.currency) {
    // Deliberately an exception, not a silent conversion. Mixed-currency arithmetic is
    // always a bug at this layer; conversion is an explicit step with a dated rate,
    // performed by the caller who knows the date.
    throw new TypeError(
      `refusing to ${verb} ${a.currency} and ${b.currency}: ` +
        "convert explicitly through a dated FX rate first",
    );
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b, "add");
  return { amount: toBig(a).plus(toBig(b)).toFixed(SCALE_DP) as Amount, currency: a.currency };
}

export function sub(a: Money, b: Money): Money {
  assertSameCurrency(a, b, "subtract");
  return { amount: toBig(a).minus(toBig(b)).toFixed(SCALE_DP) as Amount, currency: a.currency };
}

/**
 * Compare two amounts, three-valued.
 *
 * A currency mismatch is `unverified`, not `mismatch`. 4,000 SGD and 4,000 USD are not
 * in agreement, but neither have we shown they disagree -- we have shown we cannot tell.
 * Reporting that as a mismatch sends someone to investigate a discrepancy that may not
 * exist.
 *
 * Missing evidence on either side is `unverified`. It is never `ok`.
 */
export function compare(
  observed: Money | null,
  expected: Money | null,
  tolerance = "0.02",
): Verdict {
  if (observed === null || expected === null) {
    return "unverified";
  }
  if (observed.currency !== expected.currency) {
    return "unverified";
  }
  return toBig(observed).minus(toBig(expected)).abs().lte(new Big(tolerance)) ? "ok" : "mismatch";
}

/**
 * Render an amount for a person.
 *
 * **Truncates rather than rounds.** A display that rounds 8,500.0001 up to 8,500.01 is
 * inventing a hundredth of a cent nobody recorded; the stored value stays exact and the
 * caller can surface it in a tooltip. `null` renders as MISSING, never as `0`.
 */
export function formatMoney(value: Money | null, locale = "en-US"): string {
  if (value === null) {
    return MISSING;
  }
  const fixed = toBig(value).round(2, Big.roundDown).toFixed(2);
  const negative = fixed.startsWith("-");
  const [whole = "0", fraction = "00"] = (negative ? fixed.slice(1) : fixed).split(".");
  return `${negative ? "-" : ""}${BigInt(whole).toLocaleString(locale)}.${fraction}`;
}

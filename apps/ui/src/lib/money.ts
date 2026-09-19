/**
 * Money, formatted from the digits the API sent, without ever becoming a number.
 *
 * `.claude/rules/data-integrity.md` forbids `float` for a monetary amount.
 * JavaScript has exactly one numeric type and it is a float, so the only way to
 * honour that rule in a browser is never to parse the value at all.
 *
 * So `amount` is a string all the way to the DOM. Grouping and decimal places
 * are applied to the *digits*; the value is never reconstructed. An amount with
 * more precision than a double can hold renders exactly as the ledger has it,
 * which is the whole point.
 *
 * `null` is a real value and renders as MISSING, never as `0`. An empty cell is
 * visibly missing; a zero is invisibly false, and only one of those gets caught.
 *
 * ## An amount does not change shape with the interface language
 *
 * `formatMoney` groups with `,` and points with `.` in every locale, deliberately, while
 * `formatCount` and `formatBytes` below follow the reader. The asymmetry is the point: a
 * count is prose, but an amount is a ledger value that gets screenshotted into a runbook,
 * pasted into a message and read back over the phone. If the separators followed the
 * interface language, `1.234` would mean one thousand to one reader and one-and-a-bit to
 * the next, with nothing on the screen to say which -- the same class of silent, invisible
 * wrongness `.claude/rules/money.md` exists to prevent. The currency is always printed
 * beside the digits, which is what makes the fixed format unambiguous.
 */

import type { Locale } from "@undercroft/core/locale";

export interface Money {
  amount: string;
  currency: string;
}

/** What a missing value looks like. An em dash, never a zero. */
export const MISSING = "—";

/** A plain decimal: optional sign, whole part, optional fraction. Nothing else. */
const DECIMAL = /^(-?)(\d+)(?:\.(\d*))?$/u;

/**
 * Split a decimal string into its parts without arithmetic.
 *
 * Returns `null` for anything that is not a plain decimal. A value we cannot
 * read is reported as unreadable rather than coerced into something plausible.
 */
function parts(amount: string): { sign: string; whole: string; fraction: string } | null {
  const match = DECIMAL.exec(amount.trim());
  if (!match) {
    return null;
  }
  return { sign: match[1] ?? "", whole: match[2] ?? "0", fraction: match[3] ?? "" };
}

function group(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
}

/**
 * Format an amount for display.
 *
 * @param dp digits after the point. Padded or TRUNCATED, never rounded: this is
 *   a display concern and rounding here would invent a figure. The exact value
 *   stays available through {@link exactAmount}.
 */
export function formatMoney(money: Money | null | undefined, dp = 2): string {
  if (!money) {
    return MISSING;
  }

  const split = parts(money.amount);
  if (!split) {
    return MISSING;
  }

  const fraction = split.fraction.padEnd(dp, "0").slice(0, dp);
  const digits = dp > 0 ? `${group(split.whole)}.${fraction}` : group(split.whole);
  return `${split.sign}${digits} ${money.currency}`;
}

/** The unrounded digits, for a tooltip or a copy button. */
export function exactAmount(money: Money | null | undefined): string {
  return money ? `${money.amount} ${money.currency}` : MISSING;
}

/**
 * Which CLDR locale groups a plain number for each of our languages. `@/lib/when` holds the
 * same table for dates; both are small enough that sharing them would cost more than it saves.
 */
const CLDR: Record<Locale, string> = { vi: "vi-VN", en: "en-SG" };

/**
 * Counts, durations and sizes are genuinely numbers and may be formatted as such -- and
 * unlike an amount, they follow the reader's language: a Vietnamese reader groups with `.`.
 */
export function formatCount(value: number | null | undefined, locale: Locale): string {
  return value === null || value === undefined ? MISSING : value.toLocaleString(CLDR[locale]);
}

/**
 * Render any nullable text, so a missing value never renders as an empty cell
 * that looks like a layout bug rather than an absence.
 */
export function orMissing(value: string | null | undefined): string {
  return value === null || value === undefined || value === "" ? MISSING : value;
}

const UNITS = ["B", "kB", "MB", "GB", "TB"] as const;

/**
 * A byte count, for the raw lake's object sizes.
 *
 * A size is exact in a double far past any object this platform stores, so this
 * is ordinary arithmetic on a real number rather than the string handling money
 * demands. `null` still renders as MISSING: an object whose size was never
 * recorded is not an object of zero bytes.
 */
export function formatBytes(value: number | null | undefined, locale: Locale): string {
  if (value === null || value === undefined) {
    return MISSING;
  }
  if (value < 1000) {
    return `${value.toLocaleString(CLDR[locale])} B`;
  }

  let size = value;
  let unit = 0;
  while (size >= 1000 && unit < UNITS.length - 1) {
    size /= 1000;
    unit += 1;
  }
  return `${size.toFixed(size < 10 ? 1 : 0)} ${UNITS[unit] ?? "B"}`;
}

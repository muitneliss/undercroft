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
 */

export type Money = { amount: string; currency: string };

/** What a missing value looks like. An em dash, never a zero. */
export const MISSING = "—";

/**
 * Split a decimal string into its parts without arithmetic.
 *
 * Returns `null` for anything that is not a plain decimal. A value we cannot
 * read is reported as unreadable rather than coerced into something plausible.
 */
function parts(amount: string): { sign: string; whole: string; fraction: string } | null {
  const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(amount.trim());
  if (!match) return null;
  return { sign: match[1] ?? "", whole: match[2] ?? "0", fraction: match[3] ?? "" };
}

function group(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Format an amount for display.
 *
 * @param dp digits after the point. Padded or TRUNCATED, never rounded: this is
 *   a display concern and rounding here would invent a figure. The exact value
 *   stays available through {@link exactAmount}.
 */
export function formatMoney(money: Money | null | undefined, dp = 2): string {
  if (!money) return MISSING;

  const split = parts(money.amount);
  if (!split) return MISSING;

  const fraction = split.fraction.padEnd(dp, "0").slice(0, dp);
  const digits = dp > 0 ? `${group(split.whole)}.${fraction}` : group(split.whole);
  return `${split.sign}${digits} ${money.currency}`;
}

/** The unrounded digits, for a tooltip or a copy button. */
export function exactAmount(money: Money | null | undefined): string {
  return money ? `${money.amount} ${money.currency}` : MISSING;
}

/** Counts, durations and sizes are genuinely numbers and may be formatted as such. */
export function formatCount(value: number | null | undefined): string {
  return value === null || value === undefined ? MISSING : value.toLocaleString("en-SG");
}

/**
 * Render any nullable text, so a missing value never renders as an empty cell
 * that looks like a layout bug rather than an absence.
 */
export function orMissing(value: string | null | undefined): string {
  return value === null || value === undefined || value === "" ? MISSING : value;
}

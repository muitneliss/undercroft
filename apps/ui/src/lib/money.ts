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

// biome-ignore-all lint/nursery/useNamedCaptureGroup: These regexes match one thing and read it out of group 1 on the next line. A name helps a pattern with several groups; every one of these has one.
// biome-ignore-all lint/performance/useTopLevelRegex: Worth doing, and not done here: hoisting these 45 literals is a real change to 22 files and belongs in its own commit where the diff is reviewable, not buried in a lint migration. Recorded rather than silently dropped.
// biome-ignore-all lint/style/noMagicNumbers: What is left after the domain constants were named (see the WCAG block in acetate.ts) is structural: string slice offsets, the radix argument to parseInt, padStart widths, rounding factors. A name like SLICE_START_OF_GREEN_CHANNEL does not tell a reader anything the expression did not. The rule has no allow-list option, so it is per file or not at all.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useExportsLast: Reordering 28 modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. The ordering carries meaning here and the rule's preferred one does not.
// biome-ignore-all lint/suspicious/noUnnecessaryConditions: Checks the inference engine believes are redundant which guard values arriving from outside the type system: a parsed payload, an environment variable, a row from a query. A check the compiler thinks is unnecessary is the one that catches the payload that lied.

export interface Money {
  amount: string;
  currency: string;
}

/** What a missing value looks like. An em dash, never a zero. */
export const MISSING = "—";

/**
 * Split a decimal string into its parts without arithmetic.
 *
 * Returns `null` for anything that is not a plain decimal. A value we cannot
 * read is reported as unreadable rather than coerced into something plausible.
 */
function parts(amount: string): { sign: string; whole: string; fraction: string } | null {
  const match = /^(-?)(\d+)(?:\.(\d*))?$/u.exec(amount.trim());
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

const UNITS = ["B", "kB", "MB", "GB", "TB"] as const;

/**
 * A byte count, for the raw lake's object sizes.
 *
 * A size is exact in a double far past any object this platform stores, so this
 * is ordinary arithmetic on a real number rather than the string handling money
 * demands. `null` still renders as MISSING: an object whose size was never
 * recorded is not an object of zero bytes.
 */
export function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return MISSING;
  }
  if (value < 1000) {
    return `${value.toLocaleString("en-SG")} B`;
  }

  let size = value;
  let unit = 0;
  while (size >= 1000 && unit < UNITS.length - 1) {
    size /= 1000;
    unit += 1;
  }
  return `${size.toFixed(size < 10 ? 1 : 0)} ${UNITS[unit] ?? "B"}`;
}

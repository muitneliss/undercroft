/**
 * Putting a value from either side into one spelling, so the Xero → lake comparison is one of
 * equal strings. Money stays a string throughout: `parseAmount`, then `toFixed(4)`.
 */

import { parseAmount } from "@undercroft/core/money";

/** Written where an amount is absent: never `0`, which would pass for a real zero. */
export const NO_AMOUNT = "(none)";

/** An amount at four places, the most Xero keeps, or {@link NO_AMOUNT}. */
export function amount(text: string | null): string {
  const value = parseAmount(text);
  return value === null ? NO_AMOUNT : value.toFixed(4);
}

/** The same amount without its sign; the export writes credit notes negative, Xero positive. */
export function unsigned(text: string | null): string {
  const value = parseAmount(text);
  return value === null ? NO_AMOUNT : value.abs().toFixed(4);
}

/** An amount with its sign turned when `negative`. */
export function signed(text: string | null, negative: boolean): string {
  const value = parseAmount(text);
  if (value === null) {
    return NO_AMOUNT;
  }
  return (negative ? value.times(-1) : value).toFixed(4);
}

/** `a - b` at four places; {@link NO_AMOUNT} if either is absent, never a guessed zero. */
export function difference(a: string, b: string): string {
  const left = parseAmount(a);
  const right = parseAmount(b);
  return left === null || right === null ? NO_AMOUNT : left.minus(right).toFixed(4);
}

const WHITESPACE = /\s+/u;
const ALL_WHITESPACE = /\s+/gu;
const NON_DIGITS = /\D+/gu;

/** Text with every run of whitespace made one space, and trimmed. */
export function words(text: string | null | undefined): string {
  return (text ?? "").split(WHITESPACE).filter(Boolean).join(" ");
}

/** A description with no whitespace at all: the export drops the line breaks Xero keeps. */
export function bare(text: string | null | undefined): string {
  return (text ?? "").replaceAll(ALL_WHITESPACE, "");
}

/** Only the digits, which is how a phone number compares across the two spellings. */
export function digits(text: string | null | undefined): string {
  return (text ?? "").replaceAll(NON_DIGITS, "");
}

/** Code-unit order: a stable order for comparing two bags, whatever the locale. */
export function byCode(a: string, b: string): -1 | 0 | 1 {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

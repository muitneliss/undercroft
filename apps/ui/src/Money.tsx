/**
 * Rendering a money amount.
 *
 * The amount arrives as a string and stays one; `formatMoney` truncates rather than
 * rounds (a display must not invent a hundredth of a cent) and renders a missing value as
 * an em dash, never `0`. The exact stored value is put in the `title`, so hovering shows
 * every digit the formatted view trims.
 */

import { formatMoney, type Iso4217, type Money as MoneyValue, MISSING } from "@undercroft/core";

export function Money({ value }: { value: MoneyValue | null }): React.ReactElement {
  if (value === null) {
    return (
      <span data-testid="money" aria-label="no amount recorded">
        {MISSING}
      </span>
    );
  }
  return (
    <span data-testid="money" title={`${value.amount} ${value.currency}`}>
      {formatMoney(value)}&nbsp;{value.currency}
    </span>
  );
}

/** Build a `Money` from an amount string and a currency code, for props from the API. */
export function asMoney(amount: string | null, currency: string): MoneyValue | null {
  if (amount === null) return null;
  return { amount: amount as MoneyValue["amount"], currency: currency as Iso4217 };
}

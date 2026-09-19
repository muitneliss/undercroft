/**
 * The one place a ledger value becomes a float: to be plotted.
 *
 * A chart is not a ledger. A bar's height is a position on a screen, exact to a pixel and
 * no further, and a `numeric(18,4)` that has been through a double is a perfectly good bar.
 * What it is not is a figure anybody may read -- so every figure a reader CAN read (a
 * tooltip, a data label, a KPI tile, a pivot total) comes from the original string through
 * `formatDecimal`, never from the float made here. `chartData.ts` carries both side by
 * side, `values[]` for the canvas and `raw[]` for the eye.
 *
 * Nothing here guesses. A cell that cannot be read as a number, or a column whose type is
 * not numeric, plots as `null` -- a gap in the line -- and never as `0`, which would be a
 * bar of invented height.
 */

import Big from "big.js";

import type { Cell } from "@/lib/cells.ts";

const NUMERIC_TYPES = new Set([
  "numeric",
  "bigint",
  "integer",
  "smallint",
  "real",
  "double precision",
]);

/** Whether a Postgres type name is one a chart can plot. */
export function isNumericType(pgType: string): boolean {
  return NUMERIC_TYPES.has(pgType);
}

/**
 * A cell as a plot position, or `null` for a gap.
 *
 * A number arrived as one (an `integer`, a `real`) and is used as it came; a boolean is
 * 1 or 0; a string is a `numeric` or a `bigint` the driver kept exact, and is read through
 * `big.js` so an unreadable one is refused rather than `NaN`-ed into a zero.
 */
export function plotValue(cell: Cell, pgType: string): number | null {
  if (cell === null) {
    return null;
  }
  if (typeof cell === "number") {
    return Number.isFinite(cell) ? cell : null;
  }
  if (typeof cell === "boolean") {
    return cell ? 1 : 0;
  }
  if (!isNumericType(pgType)) {
    return null;
  }
  try {
    // biome-ignore lint/plugin: money.grit's own words: "`Big#toNumber()` is the float you spent a library avoiding. It exists for charting, and a chart is not a ledger." This is the charting; every readable figure comes from the string.
    return new Big(cell).toNumber();
  } catch {
    return null;
  }
}

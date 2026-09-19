/**
 * How one cell of a query result reads.
 *
 * The server sends a `numeric` or a `bigint` as a STRING and this prints it verbatim: every
 * digit the database holds, no grouping, no rounding -- `.claude/rules/money.md` all the
 * way to the screen. An integer that arrived as a number is grouped the reader's way; any
 * other number is printed as it came, because a locale formatter would round a `double` to
 * three places and call it the value. Null is MISSING, never an empty cell.
 */

import type { Locale } from "@undercroft/core/locale";
import type { TFunction } from "i18next";

import { formatCount, MISSING } from "@/lib/money.ts";

export type Cell = string | number | boolean | null;

export function cellText(t: TFunction, cell: Cell, locale: Locale): string {
  if (cell === null) {
    return MISSING;
  }
  if (typeof cell === "boolean") {
    return cell ? t("result.yes") : t("result.no");
  }
  if (typeof cell === "number") {
    return Number.isInteger(cell) ? formatCount(cell, locale) : String(cell);
  }
  return cell;
}

/**
 * A question's result as a CSV file: exactly the rows and columns the reader has on screen.
 *
 * The file is built in the browser from the `TableResult` already fetched, so it can only
 * ever hold what the reader's own run returned under the tenant's own login -- there is no
 * second read path that could reach further than the screen does.
 *
 * Three rules shape every field, and each is a way a spreadsheet would otherwise lie:
 *
 * - **A figure is the string the database sent.** A `numeric` arrives as text with every
 *   digit and its sign, and is written as it came -- never through a float, never grouped,
 *   never rounded (`.claude/rules/money.md`). `-1234.5670` stays `-1234.5670`.
 * - **Missing is an empty field, never `0`.** A spreadsheet reads an empty cell as blank;
 *   a written `0` would be a figure nobody reported.
 * - **A text cell never opens as a formula.** A cell a spreadsheet reads as the start of a
 *   formula (`=`, `+`, `-`, `@`, and a leading tab or carriage return) is prefixed with a
 *   single quote, which every spreadsheet reads as "this is text". The raw lake holds text
 *   written by people outside this system, and a downloaded `=HYPERLINK(...)` is how that
 *   text would reach someone's machine. The guard is decided by the COLUMN's type, not by
 *   the value's look: a numeric column's plain number keeps its minus sign, so a negative
 *   amount is not turned into text; a text column's `-5` is quoted, because it is text.
 *
 * Fields are quoted per RFC 4180 and lines end in CRLF. The file carries a byte-order mark,
 * because a spreadsheet that opens UTF-8 without one reads `Doanh thu tháng` as mojibake.
 */

import type { TableResult } from "@/api/types.ts";
import type { Cell } from "@/lib/cells.ts";
import { isNumericType } from "@/lib/plot.ts";

/** The characters that make a spreadsheet read a cell as a formula (OWASP's list). */
const FORMULA_START = /^[=+\-@\t\r]/u;

/** A number as Postgres prints one: optional minus, digits, optional fraction and exponent. */
const PLAIN_NUMBER = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;

/** A field that must be quoted: it holds the delimiter, a quote or a line break. */
const NEEDS_QUOTES = /[",\r\n]/u;

const BOM = "﻿";

function neutralised(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

function fieldText(cell: Cell, numeric: boolean): string {
  if (cell === null) {
    return "";
  }
  if (typeof cell === "boolean" || typeof cell === "number") {
    return String(cell);
  }
  return numeric && PLAIN_NUMBER.test(cell) ? cell : neutralised(cell);
}

function quoted(text: string): string {
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** The result as CSV text: a header of column names, then one line per row. */
export function resultCsv(result: TableResult): string {
  const numeric = result.columns.map((column) => isNumericType(column.type));
  const header = result.columns.map((column) => quoted(neutralised(column.name)));
  const lines = result.rows.map((row) =>
    result.columns.map((_column, i) => quoted(fieldText(row[i] ?? null, numeric[i] === true))),
  );
  return [header, ...lines].map((line) => `${line.join(",")}\r\n`).join("");
}

/** The result as a file a browser can hand to the reader. */
export function resultCsvBlob(result: TableResult): Blob {
  return new Blob([BOM, resultCsv(result)], { type: "text/csv;charset=utf-8" });
}

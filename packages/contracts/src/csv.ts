/**
 * A result as CSV: the one encoder the browser's download and the worker's export share.
 *
 * One module because a CSV that leaves this platform is a file somebody opens in a spreadsheet,
 * and the rules below are each a way that spreadsheet would otherwise lie. Two encoders would be
 * two places for one of them to be forgotten. It is written to be fed a row at a time -- the
 * worker streams an export of any length through it (ADR 0111) -- and the whole-result form the
 * browser uses is the same two functions over a list.
 *
 * - **A figure is the string the database sent.** A `numeric` arrives as text with every digit
 *   and its sign, and is written as it came -- never through a float, never grouped, never
 *   rounded (`.claude/rules/money.md`). `-1234.5670` stays `-1234.5670`.
 * - **Missing is an empty field, never `0`.** A spreadsheet reads an empty cell as blank; a
 *   written `0` would be a figure nobody reported.
 * - **A text cell never opens as a formula.** A cell a spreadsheet reads as the start of a
 *   formula (`=`, `+`, `-`, `@`, and a leading tab or carriage return) is prefixed with a single
 *   quote, which every spreadsheet reads as "this is text". The raw lake holds text written by
 *   people outside this system, and a downloaded `=HYPERLINK(...)` is how that text would reach
 *   someone's machine. The guard is decided by the COLUMN's type, not by the value's look: a
 *   numeric column's plain number keeps its minus sign, so a negative amount is not turned into
 *   text; a text column's `-5` is quoted, because it is text.
 *
 * Fields are quoted per RFC 4180 and lines end in CRLF. A file starts with a byte-order mark,
 * because a spreadsheet that opens UTF-8 without one reads `Doanh thu tháng` as mojibake.
 *
 * Browser-safe: nothing here reaches a Node built-in, so the SPA imports it as
 * `@undercroft/contracts/csv` without pulling the barrel.
 */

import { type Cell, isNumericType, type TableResult } from "./transformApi.ts";

/** The characters that make a spreadsheet read a cell as a formula (OWASP's list). */
const FORMULA_START = /^[=+\-@\t\r]/u;

/** A number as Postgres prints one: optional minus, digits, optional fraction and exponent. */
const PLAIN_NUMBER = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;

/** A field that must be quoted: it holds the delimiter, a quote or a line break. */
const NEEDS_QUOTES = /[",\r\n]/u;

/** What a CSV file starts with, so a spreadsheet reads it as UTF-8. */
export const CSV_BOM = "﻿";

/** The media type a CSV file is served and saved as. */
export const CSV_MEDIA_TYPE = "text/csv;charset=utf-8";

type Columns = TableResult["columns"];

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

/** The header line: the column names, each guarded and quoted like any text cell. */
export function csvHeader(columns: Columns): string {
  return `${columns.map((column) => quoted(neutralised(column.name))).join(",")}\r\n`;
}

/**
 * A writer of data lines for `columns`, deciding once which of them are numeric.
 *
 * A function rather than a per-call flag, so a stream of a million rows does not look a column's
 * type up a million times.
 */
export function csvRows(columns: Columns): (rows: readonly (readonly Cell[])[]) => string {
  const numeric = columns.map((column) => isNumericType(column.type));
  return (rows) =>
    rows
      .map(
        (row) =>
          `${columns.map((_column, i) => quoted(fieldText(row[i] ?? null, numeric[i] === true))).join(",")}\r\n`,
      )
      .join("");
}

/** A whole result as CSV text: the header, then one line per row. No byte-order mark. */
export function resultCsv(result: TableResult): string {
  return csvHeader(result.columns) + csvRows(result.columns)(result.rows);
}

/** Characters a file system refuses in a name, and the line breaks no header may carry. */
const UNSAFE_FILENAME = /[\\/:*?"<>|\r\n]/gu;

/** A file name for a CSV named `name`: refused characters replaced rather than dropped. */
export function csvFileName(name: string, fallback: string): string {
  const cleaned = name.replace(UNSAFE_FILENAME, "_").trim();
  return `${cleaned === "" ? fallback : cleaned}.csv`;
}

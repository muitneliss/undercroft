/**
 * Reading the CSV files Xero's web app exports. RFC 4180, plus what Xero actually writes: a
 * leading BOM, CRLF line ends, and quotes inside an unquoted field.
 */

const BOM = "﻿";

/** One row under its header: every column the header names, empty where the row is short. */
export type CsvRow = Readonly<Record<string, string>>;

/** A quoted field from just after its opening quote: its text, and where reading resumes. */
function quoted(text: string, start: number): { value: string; next: number } {
  let value = "";
  let index = start;
  while (index < text.length) {
    const char = text[index];
    if (char === '"' && text[index + 1] === '"') {
      value += '"';
      index += 2;
    } else if (char === '"') {
      return { value, next: index + 1 };
    } else {
      value += char;
      index += 1;
    }
  }
  return { value, next: index };
}

/** How many characters a line end at `index` takes: CRLF is two, a lone CR or LF one, else 0. */
function lineEnd(text: string, index: number): 0 | 1 | 2 {
  const char = text[index];
  if (char === "\r") {
    return text[index + 1] === "\n" ? 2 : 1;
  }
  return char === "\n" ? 1 : 0;
}

/**
 * Every row as its fields. A quote opens a quoted field only as the field's first character;
 * one later in an unquoted field is text, as Xero writes a description holding quotes.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let index = text.startsWith(BOM) ? BOM.length : 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '"' && field === "") {
      const read = quoted(text, index + 1);
      field = read.value;
      index = read.next;
    } else if (char === ",") {
      row.push(field);
      field = "";
      index += 1;
    } else if (lineEnd(text, index) > 0) {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      index += lineEnd(text, index);
    } else {
      field += char;
      index += 1;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** The rows under a header, each keyed by column; refuses a file missing a column it needs. */
export function csvRows(text: string, file: string, needed: readonly string[]): CsvRow[] {
  const [header, ...body] = parseCsv(text);
  if (header === undefined) {
    throw new Error(`${file}: empty`);
  }
  const missing = needed.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    throw new Error(`${file}: not the export expected, no column ${missing.join(", ")}`);
  }
  return body
    .filter((cells) => cells.some((value) => value !== ""))
    .map((cells) => Object.fromEntries(header.map((column, at) => [column, cells[at] ?? ""])));
}

/** One cell of a row, empty if the column is absent. */
export function cell(row: CsvRow, column: string): string {
  return row[column] ?? "";
}

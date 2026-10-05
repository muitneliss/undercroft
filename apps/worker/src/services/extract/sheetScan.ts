/**
 * One worksheet part scanned into rows of placed cells, and how the scan ended.
 *
 * `xlsx.ts` turns these rows into the two things a workbook becomes (rows a model selects, text
 * search indexes); this module only reads the sheet's grammar (ECMA-376 Part 1 §18.3), and it
 * refuses to lay out what the grammar does not let it place exactly.
 *
 * CELL VALUES STAY STRINGS, EXACTLY AS THE FILE WROTE THEM (`money.md`). Nothing here parses a
 * value: `1234.10` is copied as those seven characters, never through a float.
 */

import { integerOf } from "./numberFormats.ts";
import { stringRuns, type WorkbookPackage } from "./workbookPackage.ts";
import { attributesOf, decodeXmlText, PREFIX } from "./xml.ts";

/** Excel's last row and last column (XFD), and its longest cell. ECMA-376 Part 1 §18.3.1. */
export const MAX_ROW = 1_048_576;
const MAX_COLUMN = 16_384;
export const MAX_CELL_CHARS = 32_767;

/** Why a sheet's scan ended early. Each is a fact about the file, named for the operator. */
export const ROWS_OUT_OF_ORDER = "rows-out-of-order";
export const CELLS_OUT_OF_ORDER = "cells-out-of-order";
export const ROWS_LIMIT = "rows-limit";
export const CELL_TOO_LONG = "cell-too-long";

/** What stands in `faults` where a value would. An Excel error stands as itself (`#REF!`). */
export const FORMULA_UNCACHED = "formula-uncached";
export const SHARED_STRING_MISSING = "shared-string-missing";

type RowStop = typeof CELLS_OUT_OF_ORDER | typeof CELL_TOO_LONG;

/** One cell as scanned: where it sits, and what it holds. */
export interface Entry {
  readonly column: number;
  readonly value: string | null;
  readonly fault: string | null;
  readonly format: string | null;
}

export interface ScannedRow {
  readonly rowNumber: number;
  readonly hidden: boolean;
  readonly entries: readonly Entry[];
}

export interface Outcome {
  readonly complete: boolean;
  readonly reason: string | null;
}

export function stopped(reason: string): Outcome {
  return { complete: false, reason };
}

function element(name: string): RegExp {
  return new RegExp(
    `<${PREFIX}${name}\\b(?<attributes>[^>]*?)(?:\\/>|>(?<body>[\\s\\S]*?)<\\/${PREFIX}${name}>)`,
    "gu",
  );
}

const SHEET_DATA = element("sheetData");
const ROW = element("row");
const CELL = element("c");
const VALUE = element("v");
const INLINE_STRING = element("is");
const FORMULA = new RegExp(`<${PREFIX}f\\b`, "u");
const COLUMN_LETTERS = /^\$?(?<letters>[A-Za-z]{1,3})\$?\d+$/u;
const A_CODE = 65;
const LETTERS = 26;

function firstMatch(pattern: RegExp, source: string): RegExpMatchArray | null {
  pattern.lastIndex = 0;
  return pattern.exec(source);
}

/** The 1-based column a cell reference names (`C7` → 3), or `null` for one that names none. */
function columnOf(reference: string): number | null {
  const letters = COLUMN_LETTERS.exec(reference)?.groups?.letters;
  if (letters === undefined) {
    return null;
  }
  let column = 0;
  for (const letter of letters.toUpperCase()) {
    column = column * LETTERS + (letter.codePointAt(0) ?? 0) - A_CODE + 1;
  }
  return column <= MAX_COLUMN ? column : null;
}

/** 3 → `C`, 28 → `AB`: the letters a model selects a cell by. */
export function lettersOf(column: number): string {
  let letters = "";
  for (let rest = column; rest > 0; rest = Math.floor((rest - 1) / LETTERS)) {
    letters = String.fromCodePoint(A_CODE + ((rest - 1) % LETTERS)) + letters;
  }
  return letters;
}

/**
 * What one cell holds, by its type (ECMA-376 Part 1 §18.18.11).
 *
 * `s` indexes the shared table and `inlineStr` carries its own runs. `e` is an error, a fault.
 * Everything else -- a number, a boolean's `0`/`1`, a formula's cached string (`str`), an ISO
 * date (`d`) -- is the literal contents of `<v>`, copied and not interpreted.
 */
function contentOf(
  attributes: ReadonlyMap<string, string>,
  body: string,
  shared: readonly string[],
): Pick<Entry, "value" | "fault"> {
  const type = attributes.get("t") ?? "n";
  if (type === "inlineStr") {
    return { value: stringRuns(firstMatch(INLINE_STRING, body)?.groups?.body ?? ""), fault: null };
  }
  const stored = firstMatch(VALUE, body)?.groups?.body;
  if (stored === undefined) {
    return { value: null, fault: FORMULA.test(body) ? FORMULA_UNCACHED : null };
  }
  const raw = decodeXmlText(stored);
  if (type === "e") {
    return { value: null, fault: raw };
  }
  if (type !== "s") {
    return { value: raw, fault: null };
  }
  const resolved = shared[integerOf(raw) ?? -1];
  // An index the table cannot answer is a fault, never the raw number, which would put a row
  // number where a word belongs.
  return resolved === undefined
    ? { value: null, fault: SHARED_STRING_MISSING }
    : { value: resolved, fault: null };
}

/** A cell's entry, `null` for a cell that holds nothing, or why the row cannot go on. */
function entryOf(
  attributes: ReadonlyMap<string, string>,
  body: string,
  column: number,
  workbook: WorkbookPackage,
): Entry | null | RowStop {
  const { value, fault } = contentOf(attributes, body, workbook.sharedStrings);
  if ((value ?? "").length > MAX_CELL_CHARS) {
    return CELL_TOO_LONG;
  }
  const held = value === "" ? null : value;
  if (held === null && fault === null) {
    return null;
  }
  const style = integerOf(attributes.get("s"));
  return {
    column,
    value: held,
    fault,
    format: style === null ? null : workbook.numberFormat(style),
  };
}

/**
 * One row's cells, each in the column its reference names, or the reason the row cannot be
 * laid out exactly.
 *
 * PLACED BY `r`, NOT BY POSITION IN THE XML. Excel omits an empty cell entirely, so a row
 * holding A and C is two `<c>` elements; joined in document order, C slid into B. A cell with
 * no `r` takes the column after the one before it (§18.3.1.4). Cells must run left to right,
 * and one that does not is never laid out by a guess.
 */
function rowEntries(body: string, workbook: WorkbookPackage): Entry[] | RowStop {
  const entries: Entry[] = [];
  let previous = 0;
  for (const cell of body.matchAll(CELL)) {
    const attributes = attributesOf(cell.groups?.attributes ?? "");
    const reference = attributes.get("r");
    const column = reference === undefined ? previous + 1 : columnOf(reference);
    if (column === null || column <= previous) {
      return CELLS_OUT_OF_ORDER;
    }
    previous = column;
    const entry = entryOf(attributes, cell.groups?.body ?? "", column, workbook);
    if (typeof entry === "string") {
      return entry;
    }
    if (entry !== null) {
      entries.push(entry);
    }
  }
  return entries;
}

/** A row's number: its `r`, or the one after the row before it; `null` when neither can be. */
function rowNumberOf(stated: string | undefined, previous: number): number | null {
  const rowNumber = stated === undefined ? previous + 1 : integerOf(stated);
  return rowNumber === null || rowNumber <= previous ? null : rowNumber;
}

/**
 * A sheet's non-empty rows in order, returning how the scan ended.
 *
 * A row out of order, or past Excel's last row, or holding a cell that cannot be placed, ends
 * the scan: the rows before it are exact, and the outcome says the sheet is incomplete.
 */
export function* scanSheet(xml: string, workbook: WorkbookPackage): Generator<ScannedRow, Outcome> {
  const data = firstMatch(SHEET_DATA, xml)?.groups?.body ?? "";
  let previous = 0;
  for (const row of data.matchAll(ROW)) {
    const attributes = attributesOf(row.groups?.attributes ?? "");
    const rowNumber = rowNumberOf(attributes.get("r"), previous);
    if (rowNumber === null) {
      return stopped(ROWS_OUT_OF_ORDER);
    }
    if (rowNumber > MAX_ROW) {
      return stopped(ROWS_LIMIT);
    }
    previous = rowNumber;
    const entries = rowEntries(row.groups?.body ?? "", workbook);
    if (typeof entries === "string") {
      return stopped(entries);
    }
    if (entries.length > 0) {
      const hidden = attributes.get("hidden");
      yield { rowNumber, hidden: hidden === "1" || hidden === "true", entries };
    }
  }
  return { complete: true, reason: null };
}

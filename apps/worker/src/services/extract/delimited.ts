/**
 * A delimited text file read into rows, by the grammar its media type states. ADR 0107.
 *
 * `text/csv` IS RFC 4180: a comma between fields, a line break between records, a field that
 * holds either wrapped in double quotes with a quote inside written twice. `text/tab-separated-
 * values` is IANA's registration: a tab between fields, a line break between records, and no
 * quoting at all, because a field may hold neither. Neither is a guess -- the type the provider
 * declared names the grammar, which is the difference from sniffing a delimiter out of the
 * content, which this does not do. A semicolon file sent as `text/csv` is therefore one field per record,
 * which is what its bytes say under that grammar; a model splits it if it wants to.
 *
 * WHERE THE GRAMMAR IS BENT, it is bent the way every spreadsheet bends it, and only where no
 * reading is lost: a record may end in CRLF, LF or a lone CR, and a double quote in the middle of
 * an unquoted field is that character. A closing quote followed by anything but a comma or a line
 * break, or a quoted field the file never closes, is not something the grammar has a reading for:
 * the rows before it are kept and the sheet stops there, saying why (`csv-malformed`).
 *
 * Values stay the strings the file holds (`money.md`): `1234.10` is those seven characters.
 */

import {
  CELL_TOO_LONG,
  type Entry,
  MAX_CELL_CHARS,
  MAX_ROW,
  ROWS_LIMIT,
  type ScannedRow,
} from "./sheetCells.ts";
import type { SheetEnd } from "./sheetScan.ts";
import { assembleWorkbook, type Workbook } from "./xlsx.ts";

/** A record that RFC 4180 has no reading for; the rows before it stand. */
export const CSV_MALFORMED = "csv-malformed";
/** Why a delimited file's one sheet has no name: the format has no sheets to name. */
export const NO_SHEETS = "delimited-text-has-no-sheets";
/** A record past XFD, the last column a sheet of rows can address. */
export const COLUMNS_LIMIT = "columns-limit";

const MAX_COLUMN = 16_384;
const QUOTE = '"';
const CR = "\r";
const LF = "\n";

/** How one file's fields are separated, and whether a field may be quoted. */
export interface Grammar {
  readonly separator: string;
  readonly quoted: boolean;
}

export const CSV: Grammar = { separator: ",", quoted: true };
export const TSV: Grammar = { separator: "\t", quoted: false };

/** One record's fields, and where the next record begins. */
interface ParsedRecord {
  readonly fields: string[];
  readonly next: number;
}

/** Past the line break at `at`: CRLF, LF or a lone CR. */
function afterBreak(text: string, at: number): number {
  return text[at] === CR && text[at + 1] === LF ? at + 2 : at + 1;
}

function isBreak(character: string | undefined): boolean {
  return character === CR || character === LF;
}

/** A quoted field from its opening quote: its value, and where it ends; `null` if never closed. */
function quotedField(text: string, from: number): { value: string; at: number } | null {
  let value = "";
  let at = from + 1;
  for (;;) {
    const quote = text.indexOf(QUOTE, at);
    if (quote === -1) {
      return null;
    }
    value += text.slice(at, quote);
    if (text[quote + 1] !== QUOTE) {
      return { value, at: quote + 1 };
    }
    value += QUOTE;
    at = quote + 2;
  }
}

/** An unquoted field: everything up to the separator or the line break that ends it. */
function plainField(text: string, from: number, separator: string): { value: string; at: number } {
  let at = from;
  while (at < text.length && text[at] !== separator && !isBreak(text[at])) {
    at += 1;
  }
  return { value: text.slice(from, at), at };
}

/** The record that starts at `from`, or `null` when the grammar has no reading for it. */
function readRecord(text: string, from: number, grammar: Grammar): ParsedRecord | null {
  const fields: string[] = [];
  let at = from;
  for (;;) {
    const field =
      grammar.quoted && text[at] === QUOTE
        ? quotedField(text, at)
        : plainField(text, at, grammar.separator);
    if (field === null) {
      return null;
    }
    fields.push(field.value);
    ({ at } = field);
    if (at >= text.length) {
      return { fields, next: at };
    }
    if (isBreak(text[at])) {
      return { fields, next: afterBreak(text, at) };
    }
    if (text[at] !== grammar.separator) {
      return null;
    }
    at += 1;
  }
}

/** A record's fields as placed cells: every non-empty field under its column, or why it stops. */
function entriesOf(
  fields: readonly string[],
): Entry[] | typeof COLUMNS_LIMIT | typeof CELL_TOO_LONG {
  if (fields.length > MAX_COLUMN) {
    return COLUMNS_LIMIT;
  }
  const entries: Entry[] = [];
  for (const [at, value] of fields.entries()) {
    if (value.length > MAX_CELL_CHARS) {
      return CELL_TOO_LONG;
    }
    if (value !== "") {
      entries.push({ column: at + 1, value, fault: null, format: null });
    }
  }
  return entries;
}

function ended(reason: string | null): SheetEnd {
  return { complete: reason === null, reason, dimension: null, merges: [] };
}

/**
 * A delimited file's records as rows, numbered as the file's records are -- a blank line is a
 * record with nothing in it, so the row after it keeps its number -- and how the read ended.
 */
export function* scanDelimited(text: string, grammar: Grammar): Generator<ScannedRow, SheetEnd> {
  let at = 0;
  for (let rowNumber = 1; at < text.length; rowNumber += 1) {
    if (rowNumber > MAX_ROW) {
      return ended(ROWS_LIMIT);
    }
    const record = readRecord(text, at, grammar);
    if (record === null) {
      return ended(CSV_MALFORMED);
    }
    at = record.next;
    const entries = entriesOf(record.fields);
    if (typeof entries === "string") {
      return ended(entries);
    }
    if (entries.length > 0) {
      yield { rowNumber, hidden: false, entries };
    }
  }
  return ended(null);
}

/**
 * A delimited file as a workbook of one sheet. It has no sheet name to give -- the format has no
 * sheets -- so the name is `null` with that said, and no 1904 epoch to state (`null`).
 */
export async function delimitedWorkbook(text: string, grammar: Grammar): Promise<Workbook | null> {
  const reading = await assembleWorkbook(
    { container: grammar === CSV ? "csv" : "tsv", date1904: null },
    [
      {
        index: 1,
        name: null,
        nameReason: NO_SHEETS,
        kind: "worksheet",
        state: "visible",
        scan: () => scanDelimited(text, grammar),
      },
    ],
    // The text of a delimited file is the file itself (`readDelimited` in `extractText.ts`);
    // nothing of the rendering is kept.
    0,
  );
  return reading?.workbook ?? null;
}

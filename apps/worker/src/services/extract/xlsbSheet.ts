/**
 * One sheet of an Excel binary workbook read as its part inflates, into rows of placed cells,
 * and how the read ended. ADR 0109; [MS-XLSB] §2.1.7.62 for the sheet's grammar.
 *
 * A BIFF12 sheet states each row once, in a `BrtRowHdr`, and the cells of that row follow it,
 * each a record naming its column, its cell format and its value. So a cell's row is the row
 * header before it, and a row is whole when the next row header -- or the end of the part --
 * comes. Rows run in order and the cells of a row left to right; one that does not is never
 * placed by a guess, and stops the sheet with the reason the other readers give.
 *
 * VALUES ARE THE STRINGS AN `.xlsx` WOULD HOLD (ADR 0104 decision 7, `money.md`). A number is an
 * IEEE-754 double or an RK, exactly as in BIFF8, and is rendered once by `biff8Values.ts`; a
 * formula's record carries its cached result first, and that result is the cell's value.
 */

import { doubleText, errorOf, rkText } from "./biff8Values.ts";
import type { PartBytes } from "./opcPackage.ts";
import {
  CELL_TOO_LONG,
  CELLS_OUT_OF_ORDER,
  type Entry,
  MAX_CELL_CHARS,
  MAX_COLUMN,
  MAX_ROW,
  ROWS_LIMIT,
  ROWS_OUT_OF_ORDER,
  rangeOf,
  type ScannedRow,
  SHARED_STRING_MISSING,
} from "./sheetCells.ts";
import { SHEET_TOO_LARGE, SHEET_UNREADABLE, type SheetEnd } from "./sheetScan.ts";
import { bit, Fields } from "./xlsbFields.ts";
import { BRT, recordsOf, type XlsbRecord } from "./xlsbRecords.ts";
import type { StreamEnd } from "./zip.ts";

/** What every sheet of one workbook refers to: its shared strings and its cell formats. */
export interface XlsbBook {
  readonly shared: readonly string[];
  readonly formatOf: (xf: number) => string | null;
}

type Held = Pick<Entry, "value" | "fault">;

const NOTHING_HELD: Held = { value: null, fault: null };

function boolean(fields: Fields): Held {
  return { value: fields.uint8() === 0 ? "0" : "1", fault: null };
}

function error(fields: Fields): Held {
  return { value: null, fault: errorOf(fields.uint8()) };
}

function real(fields: Fields): Held {
  return { value: doubleText(fields.double()), fault: null };
}

function text(fields: Fields): Held {
  return { value: fields.wideString(), fault: null };
}

function sharedString(fields: Fields, shared: readonly string[]): Held {
  const found = shared[fields.uint32()];
  // An index the table cannot answer is a fault, never the number, which is not a word.
  return found === undefined
    ? { value: null, fault: SHARED_STRING_MISSING }
    : { value: found, fault: null };
}

/**
 * What each cell record holds, read from the bytes after its `Cell` (§2.5.10). A formula's record
 * (`BrtFmla*`) states its cached result where the plain cell of the same type states its value,
 * so the two read alike, and the formula after the result is left unread.
 */
const VALUES: ReadonlyMap<number, (fields: Fields, shared: readonly string[]) => Held> = new Map([
  [BRT.cellBlank, (): Held => NOTHING_HELD],
  [BRT.cellRk, (fields: Fields): Held => ({ value: rkText(fields.uint32()), fault: null })],
  [BRT.cellError, error],
  [BRT.cellBool, boolean],
  [BRT.cellReal, real],
  [BRT.cellSt, text],
  [BRT.cellIsst, sharedString],
  [BRT.fmlaString, text],
  [BRT.fmlaNum, real],
  [BRT.fmlaBool, boolean],
  [BRT.fmlaError, error],
  [BRT.cellRString, (fields: Fields): Held => ({ value: fields.richString(), fault: null })],
]);

const SHEET_RECORDS: ReadonlySet<number> = new Set([
  BRT.rowHdr,
  BRT.wsDim,
  BRT.mergeCell,
  ...VALUES.keys(),
]);

/**
 * `BrtRowHdr` (§2.4.770): `rw` at 0, then `ixfe`, `miyRw` and a byte of flags; `fDyZero`, the
 * hidden row, is bit 4 of byte 11, beside the outline level and `fCollapsed`.
 */
const ROW_FLAGS_AT = 11;
const DY_ZERO = 4;
/** `Cell.iStyleRef` is 24 bits across three bytes, low byte first; the fourth holds flags. */
const BYTE = 256;

const ENDED: Readonly<Record<Exclude<StreamEnd, "complete">, string>> = {
  "too-large": SHEET_TOO_LARGE,
  unreadable: SHEET_UNREADABLE,
};

/** Where a scan is: the row being gathered, and the facts outside the cells. */
interface Scan {
  row: number | null;
  hidden: boolean;
  entries: Entry[];
  column: number;
  dimension: string | null;
  merges: string[];
}

/** What one record did: a row it completed, and the reason the sheet stops at it. */
interface Step {
  readonly done: ScannedRow | null;
  readonly stop: string | null;
}

const NOTHING: Step = { done: null, stop: null };

/**
 * A zero-based, inclusive `UncheckedRfX` (§2.5.154) -- rows first, then columns -- as Excel
 * writes a range. Bounds that are no range on a sheet are a record that cannot be read.
 */
function rangeFrom(fields: Fields): string {
  const [firstRow, lastRow, firstColumn, lastColumn] = [
    fields.int32(),
    fields.int32(),
    fields.int32(),
    fields.int32(),
  ];
  if (
    firstRow < 0 ||
    firstColumn < 0 ||
    lastRow < firstRow ||
    lastColumn < firstColumn ||
    lastRow >= MAX_ROW ||
    lastColumn >= MAX_COLUMN
  ) {
    throw new RangeError("not a range on a sheet");
  }
  return rangeOf(firstRow, lastRow, firstColumn, lastColumn);
}

/** The row gathered so far, handed on when it holds anything. */
function finished(scan: Scan): ScannedRow | null {
  return scan.row === null || scan.entries.length === 0
    ? null
    : { rowNumber: scan.row, hidden: scan.hidden, entries: scan.entries };
}

/**
 * A row header: the row before it is whole, and this one begins -- unless it comes out of order
 * or past Excel's last row, which stops the sheet after the row before it.
 */
function beginRow(fields: Fields, scan: Scan): Step {
  const rowNumber = fields.int32() + 1;
  fields.skip(ROW_FLAGS_AT - 4);
  const hidden = bit(fields.uint8(), DY_ZERO);
  const done = finished(scan);
  if (rowNumber <= (scan.row ?? 0) || rowNumber > MAX_ROW) {
    return { done, stop: rowNumber > MAX_ROW ? ROWS_LIMIT : ROWS_OUT_OF_ORDER };
  }
  Object.assign(scan, { row: rowNumber, hidden, entries: [], column: 0 });
  return { done, stop: null };
}

/**
 * A cell, placed in the row its row header began. One that cannot be placed exactly stops the
 * sheet, and its row, missing a cell, is not handed on.
 */
function placeCell(record: XlsbRecord, fields: Fields, scan: Scan, book: XlsbBook): Step {
  const column = fields.int32() + 1;
  const xf = fields.uint8() + fields.uint8() * BYTE + fields.uint8() * BYTE * BYTE;
  fields.skip(1);
  if (scan.row === null) {
    // A cell before any row header has no row to be placed in.
    return { done: null, stop: SHEET_UNREADABLE };
  }
  if (column <= scan.column || column > MAX_COLUMN) {
    return { done: null, stop: CELLS_OUT_OF_ORDER };
  }
  scan.column = column;
  const { value, fault } = VALUES.get(record.type)?.(fields, book.shared) ?? NOTHING_HELD;
  if ((value ?? "").length > MAX_CELL_CHARS) {
    return { done: null, stop: CELL_TOO_LONG };
  }
  const held = value === "" ? null : value;
  if (held !== null || fault !== null) {
    scan.entries.push({ column, value: held, fault, format: book.formatOf(xf) });
  }
  return NOTHING;
}

/** What one record contributes to the scan. A record shorter than its layout breaks the sheet. */
function take(record: XlsbRecord, scan: Scan, book: XlsbBook): Step {
  const fields = new Fields(record.data);
  try {
    switch (record.type) {
      case BRT.rowHdr:
        return beginRow(fields, scan);
      case BRT.wsDim:
        scan.dimension = rangeFrom(fields);
        return NOTHING;
      case BRT.mergeCell:
        scan.merges.push(rangeFrom(fields));
        return NOTHING;
      default:
        return placeCell(record, fields, scan, book);
    }
  } catch {
    return { done: null, stop: SHEET_UNREADABLE };
  }
}

function endOf(scan: Scan, reason: string | null): SheetEnd {
  return { complete: reason === null, reason, dimension: scan.dimension, merges: scan.merges };
}

/**
 * A sheet's non-empty rows in order, read as its part inflates, returning how the read ended.
 * A row out of order, past Excel's last row, or holding a cell that cannot be placed ends the
 * scan, as does a part that breaks or passes the stream ceiling: the rows before are exact, and
 * the row being gathered when it broke is not handed on, since its cells may not all be read.
 */
export async function* scanXlsbSheet(
  open: PartBytes,
  book: XlsbBook,
): AsyncGenerator<ScannedRow, SheetEnd> {
  const scan: Scan = {
    row: null,
    hidden: false,
    entries: [],
    column: 0,
    dimension: null,
    merges: [],
  };
  const records = recordsOf(open(), SHEET_RECORDS);
  try {
    let step = await records.next();
    while (step.done !== true) {
      const { done, stop } = take(step.value, scan, book);
      if (done !== null) {
        yield done;
      }
      if (stop !== null) {
        return endOf(scan, stop);
      }
      step = await records.next();
    }
    if (step.value !== "complete") {
      return endOf(scan, ENDED[step.value]);
    }
    const last = finished(scan);
    if (last !== null) {
      yield last;
    }
    return endOf(scan, null);
  } finally {
    await records.return("complete");
  }
}

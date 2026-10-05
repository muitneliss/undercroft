/**
 * An Excel 97–2003 workbook (`.xls`, BIFF8) read into the same sheets of rows an `.xlsx` gives.
 * ADR 0104 decision 7; [MS-XLS].
 *
 * Read in process, with no binary and no dependency, for ADR 0028's reason: `cfb.ts` already
 * opens the container for Word (ADR 0053), and the records a workbook's cells live in are short
 * enough to read exactly. What this reads: the globals -- the shared strings, the number formats
 * and the cell formats that point at them, the sheets and their visibility, the 1904 epoch --
 * and each sheet's cells, merged ranges, hidden rows and declared range. What it does not: charts,
 * pictures, comments, and the formula behind a cell, whose cached result is what the cell says.
 *
 * A WORKBOOK SAVED WITH A PASSWORD is encrypted from its globals on (`FILEPASS`), and is refused
 * by name: the bytes are intact and need the sender's password. One whose records break off is
 * refused as unreadable, never read as a shorter workbook (`CLAUDE.md` rule 2).
 */

import { type BiffRecord, Cursor, RECORD, recordsOf } from "./biffRecords.ts";
import { type Biff8Refusal, type Globals, readGlobals } from "./biff8Globals.ts";
import { type Cell, CELL_RECORDS, cellsOf } from "./biff8Cells.ts";
import { openCfb } from "./cfb.ts";
import {
  CELL_TOO_LONG,
  CELLS_OUT_OF_ORDER,
  type Entry,
  FORMULA_UNCACHED,
  MAX_CELL_CHARS,
  rangeOf,
  ROWS_OUT_OF_ORDER,
  type ScannedRow,
} from "./sheetCells.ts";
import { SHEET_UNREADABLE, type SheetEnd } from "./sheetScan.ts";
import { assembleWorkbook, type SheetSource, type WorkbookReading } from "./xlsx.ts";

const ROW_HIDDEN = 0x20;

/** Where a sheet scan is: the row being gathered, and the facts outside the cells. */
interface SheetScan {
  row: number | null;
  entries: Entry[];
  hidden: Set<number>;
  pending: Omit<Cell, "value" | "fault"> | null;
  dimension: string | null;
  merges: string[];
}

function readFacts(record: BiffRecord, scan: SheetScan): void {
  const cursor = new Cursor(record);
  if (record.type === RECORD.row) {
    const row = cursor.uint16();
    cursor.skip(10);
    if ((cursor.uint16() & ROW_HIDDEN) !== 0) {
      scan.hidden.add(row + 1);
    }
  } else if (record.type === RECORD.dimensions) {
    const first = cursor.uint32();
    const after = cursor.uint32();
    const left = cursor.uint16();
    const right = cursor.uint16();
    scan.dimension =
      after > first && right > left ? rangeOf(first, after - 1, left, right - 1) : null;
  } else if (record.type === RECORD.mergedCells) {
    const count = cursor.uint16();
    for (let at = 0; at < count; at += 1) {
      const [top, bottom, left, right] = [
        cursor.uint16(),
        cursor.uint16(),
        cursor.uint16(),
        cursor.uint16(),
      ];
      scan.merges.push(rangeOf(top, bottom, left, right));
    }
  }
}

/**
 * Add a cell to the row being gathered; a cell of a later row first hands that row back. Rows
 * and the cells in a row run in order in a BIFF8 sheet ([MS-XLS] §2.1.7.20.2), and one that
 * does not is never placed by a guess.
 */
function place(
  scan: SheetScan,
  cell: Cell,
  formatOf: Globals["formatOf"],
): { done: ScannedRow | null; stop: string | null } {
  let done: ScannedRow | null = null;
  const rowNumber = cell.row + 1;
  if (scan.row !== rowNumber) {
    if (scan.row !== null && rowNumber < scan.row) {
      return { done: null, stop: ROWS_OUT_OF_ORDER };
    }
    done =
      scan.row === null || scan.entries.length === 0
        ? null
        : { rowNumber: scan.row, hidden: scan.hidden.has(scan.row), entries: scan.entries };
    scan.row = rowNumber;
    scan.entries = [];
  }
  const column = cell.column + 1;
  if (column <= (scan.entries.at(-1)?.column ?? 0)) {
    return { done, stop: CELLS_OUT_OF_ORDER };
  }
  if ((cell.value ?? "").length > MAX_CELL_CHARS) {
    return { done, stop: CELL_TOO_LONG };
  }
  const value = cell.value === "" ? null : cell.value;
  if (value !== null || cell.fault !== null) {
    scan.entries.push({ column, value, fault: cell.fault, format: formatOf(cell.xf) });
  }
  return { done, stop: null };
}

function endOf(scan: SheetScan, reason: string | null): SheetEnd {
  return { complete: reason === null, reason, dimension: scan.dimension, merges: scan.merges };
}

/**
 * The cells a record contributes. A formula whose result is a string states it in the `STRING`
 * record after it; one whose `STRING` never comes before the next cell is a formula without its
 * result, and is said to be one rather than read as an empty cell.
 */
function recordCells(record: BiffRecord, scan: SheetScan, shared: readonly string[]): Cell[] {
  if (record.type === RECORD.string && scan.pending !== null) {
    const cell = { ...scan.pending, value: new Cursor(record).string(), fault: null };
    scan.pending = null;
    return [cell];
  }
  if (!CELL_RECORDS.has(record.type)) {
    readFacts(record, scan);
    return [];
  }
  const held = scan.pending;
  scan.pending = null;
  const cells: Cell[] = held === null ? [] : [{ ...held, value: null, fault: FORMULA_UNCACHED }];
  const read = cellsOf(record, shared);
  if (Array.isArray(read)) {
    cells.push(...read);
  } else {
    scan.pending = read.pending;
  }
  return cells;
}

/**
 * One sheet's records, from its `BOF` to its `EOF`, as rows; how the scan ended. A record that
 * breaks off part-way ends the sheet as unreadable, with the rows before it kept.
 */
function* scanBiffSheet(
  records: readonly BiffRecord[],
  from: number,
  globals: Globals,
): Generator<ScannedRow, SheetEnd> {
  const scan: SheetScan = {
    row: null,
    entries: [],
    hidden: new Set(),
    pending: null,
    dimension: null,
    merges: [],
  };
  for (const record of records.slice(from + 1)) {
    if (record.type === RECORD.eof) {
      break;
    }
    let cells: Cell[];
    try {
      cells = recordCells(record, scan, globals.shared);
    } catch {
      return endOf(scan, SHEET_UNREADABLE);
    }
    for (const cell of cells) {
      const { done, stop } = place(scan, cell, globals.formatOf);
      if (done !== null) {
        yield done;
      }
      if (stop !== null) {
        return endOf(scan, stop);
      }
    }
  }
  yield* lastRows(scan, globals);
  return endOf(scan, null);
}

/** What is left at the sheet's `EOF`: a formula whose string never came, and the open row. */
function* lastRows(scan: SheetScan, globals: Globals): Generator<ScannedRow> {
  if (scan.pending !== null) {
    const uncached = { ...scan.pending, value: null, fault: FORMULA_UNCACHED };
    const { done } = place(scan, uncached, globals.formatOf);
    if (done !== null) {
      yield done;
    }
  }
  if (scan.row !== null && scan.entries.length > 0) {
    yield { rowNumber: scan.row, hidden: scan.hidden.has(scan.row), entries: scan.entries };
  }
}

/**
 * A BIFF8 workbook read into sheets of rows and their text, or why it was not. `null` when no
 * sheet could be read -- a workbook with none is not an empty one.
 */
export async function readBiff8(
  bytes: Uint8Array,
  textLimit: number,
): Promise<WorkbookReading | null | Biff8Refusal> {
  const stream = openCfb(bytes)?.stream("Workbook") ?? null;
  const records = stream === null ? null : recordsOf(stream);
  if (records === null || records[0]?.type !== RECORD.bof) {
    return "unreadable";
  }
  let globals: Globals | Biff8Refusal;
  try {
    globals = readGlobals(records);
  } catch {
    return "unreadable";
  }
  if (typeof globals === "string") {
    return globals;
  }
  const offsets = new Map(records.map((record, at) => [record.offset, at]));
  const known = globals;
  const sources = known.sheets.map((sheet): SheetSource => {
    const from = offsets.get(sheet.at);
    return {
      index: sheet.index,
      name: sheet.name,
      nameReason: null,
      kind: sheet.kind,
      state: sheet.state,
      scan: from === undefined ? null : () => scanBiffSheet(records, from, known),
    };
  });
  return await assembleWorkbook(
    { container: "biff8", date1904: known.date1904 },
    sources,
    textLimit,
  );
}

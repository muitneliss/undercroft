/**
 * An Excel binary workbook, written the way Excel writes one: an OPC package whose workbook part,
 * sheets, shared strings and styles are BIFF12 records ([MS-XLSB]), inside a genuine zip.
 *
 * The binary half of the `.xlsb` reader's suite, as `biffTesting.ts` is the `.xls` one's. It
 * writes the records Excel writes around the ones the reader reads -- `BrtBeginSheet`, the
 * column spans of a row, the formula behind a cached result, the cell-style formats before the
 * cell formats -- each with the layout the spec gives it, so a suite exercises the format rather
 * than a stand-in for it. Nothing binary is committed, and every value is invented (`pii.md`).
 */

import { concat, zipOf } from "./testing.ts";
import { BRT, f64, record, u8, u16, u32, wide } from "./xlsbRecordTesting.ts";

/** What one cell holds, by the record Excel would write for it. */
export type XlsbValue =
  | { readonly blank: true }
  | { readonly sst: number }
  | { readonly text: string }
  | { readonly rich: string }
  | { readonly number: number }
  | { readonly rk: number }
  | { readonly bool: boolean }
  | { readonly error: number }
  | { readonly formulaText: string }
  | { readonly formulaNumber: number }
  | { readonly formulaBool: boolean }
  | { readonly formulaError: number };

/** One cell: its zero-based column, the cell format it names, and what it holds. */
export type XlsbCell = { readonly col: number; readonly xf?: number } & XlsbValue;

export interface XlsbRow {
  /** Zero-based, as `BrtRowHdr.rw` stores it. */
  readonly row: number;
  readonly hidden?: boolean;
  readonly cells: readonly XlsbCell[];
}

type Bounds = readonly [number, number, number, number];

export interface XlsbSheet {
  readonly name: string;
  /** `hsState`: 0 visible, 1 hidden, 2 very hidden. */
  readonly state?: number;
  readonly rows: readonly XlsbRow[];
  /** Zero-based, inclusive `[firstRow, lastRow, firstCol, lastCol]`, as `RfX` stores them. */
  readonly merges?: readonly Bounds[];
  /** The part ends inside the record after this many rows: a sheet whose records break off. */
  readonly breakAfterRows?: number;
}

export interface XlsbWorkbook {
  readonly sheets: readonly XlsbSheet[];
  readonly shared?: readonly string[];
  readonly date1904?: boolean;
  /** The workbook's own number formats: `[id, code]`. */
  readonly formats?: readonly (readonly [number, string])[];
  /** Each cell format's number-format id; a cell's `xf` indexes this list. */
  readonly xfs?: readonly number[];
  /** The workbook part ends inside a record. */
  readonly brokenWorkbook?: boolean;
}

const DY_ZERO = 0x10;
const MAIN = "application/vnd.ms-excel.sheet.binary.macroEnabled.main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** A `CellParsedFormula` behind a cached result: `=1`, as one `PtgInt`. */
const FORMULA = concat([u32(3), Uint8Array.of(0x1e, 1, 0), u32(0)]);
const NO_FORMULA_FLAGS = u16(0);

/** A formula's record: its cached result, its flags, then the formula (§2.4.684–687). */
function formulaRecord(cell: XlsbCell, at: Uint8Array): Uint8Array | null {
  if ("formulaText" in cell) {
    return record(BRT.fmlaString, at, wide(cell.formulaText), NO_FORMULA_FLAGS, FORMULA);
  }
  if ("formulaNumber" in cell) {
    return record(BRT.fmlaNum, at, f64(cell.formulaNumber), NO_FORMULA_FLAGS, FORMULA);
  }
  if ("formulaBool" in cell) {
    return record(BRT.fmlaBool, at, u8(cell.formulaBool ? 1 : 0), NO_FORMULA_FLAGS, FORMULA);
  }
  if ("formulaError" in cell) {
    return record(BRT.fmlaError, at, u8(cell.formulaError), NO_FORMULA_FLAGS, FORMULA);
  }
  return null;
}

function cellRecord(cell: XlsbCell): Uint8Array {
  // `Cell`: the column, then `iStyleRef` in 24 bits and a byte of flags (§2.5.10).
  const at = concat([u32(cell.col), u32(cell.xf ?? 0)]);
  if ("sst" in cell) {
    return record(BRT.cellIsst, at, u32(cell.sst));
  }
  if ("text" in cell) {
    return record(BRT.cellSt, at, wide(cell.text));
  }
  if ("rich" in cell) {
    return record(BRT.cellRString, at, u8(0), wide(cell.rich));
  }
  if ("number" in cell) {
    return record(BRT.cellReal, at, f64(cell.number));
  }
  if ("rk" in cell) {
    return record(BRT.cellRk, at, u32(cell.rk));
  }
  if ("bool" in cell) {
    return record(BRT.cellBool, at, u8(cell.bool ? 1 : 0));
  }
  if ("error" in cell) {
    return record(BRT.cellError, at, u8(cell.error));
  }
  return formulaRecord(cell, at) ?? record(BRT.cellBlank, at);
}

/** `BrtRowHdr` (§2.4.770) with one column span, then the row's cells. */
function rowRecords(row: XlsbRow): Uint8Array {
  const last = Math.max(0, ...row.cells.map((cell) => cell.col));
  const header = record(
    BRT.rowHdr,
    u32(row.row),
    u32(0),
    u16(300),
    u8(0),
    u8(row.hidden === true ? DY_ZERO : 0),
    u8(0),
    u32(1),
    u32(0),
    u32(last),
  );
  return concat([header, ...row.cells.map(cellRecord)]);
}

function rfx([firstRow, lastRow, firstCol, lastCol]: Bounds): Uint8Array {
  return concat([u32(firstRow), u32(lastRow), u32(firstCol), u32(lastCol)]);
}

function usedRange(rows: readonly XlsbRow[]): Bounds {
  const cells = rows.flatMap((row) => row.cells.map((cell) => [row.row, cell.col] as const));
  if (cells.length === 0) {
    return [0, 0, 0, 0];
  }
  const rowsUsed = cells.map(([row]) => row);
  const colsUsed = cells.map(([, col]) => col);
  return [
    Math.min(...rowsUsed),
    Math.max(...rowsUsed),
    Math.min(...colsUsed),
    Math.max(...colsUsed),
  ];
}

function sheetPart(sheet: XlsbSheet): Uint8Array {
  const rows = sheet.rows.map(rowRecords);
  const head = [record(BRT.beginSheet), record(BRT.wsDim, rfx(usedRange(sheet.rows)))];
  if (sheet.breakAfterRows !== undefined) {
    const cut = rows[sheet.breakAfterRows] ?? record(BRT.endSheetData);
    const kept = rows.slice(0, sheet.breakAfterRows);
    return concat([...head, record(BRT.beginSheetData), ...kept, cut.subarray(0, 3)]);
  }
  const merges = sheet.merges ?? [];
  return concat([
    ...head,
    record(BRT.beginSheetData),
    ...rows,
    record(BRT.endSheetData),
    ...(merges.length === 0
      ? []
      : [
          record(BRT.beginMergeCells, u32(merges.length)),
          ...merges.map((merge) => record(BRT.mergeCell, rfx(merge))),
          record(BRT.endMergeCells),
        ]),
    record(BRT.endSheet),
  ]);
}

function workbookPart(workbook: XlsbWorkbook): Uint8Array {
  const part = concat([
    record(BRT.beginBook),
    // `BrtWbProp` (§2.4.866): flags with `f1904` at bit 0, `dwThemeVersion`, the code name.
    record(BRT.wbProp, u32(workbook.date1904 === true ? 1 : 0), u32(0), wide("")),
    record(BRT.beginBundleShs),
    ...workbook.sheets.map((sheet, at) =>
      record(
        BRT.bundleSh,
        u32(sheet.state ?? 0),
        u32(at + 1),
        wide(`rId${String(at + 1)}`),
        wide(sheet.name),
      ),
    ),
    record(BRT.endBundleShs),
    record(BRT.endBook),
  ]);
  return workbook.brokenWorkbook === true ? part.subarray(0, part.byteLength - 1) : part;
}

function sharedStringsPart(shared: readonly string[]): Uint8Array {
  return concat([
    record(BRT.beginSst, u32(shared.length), u32(shared.length)),
    ...shared.map((text) => record(BRT.sstItem, u8(0), wide(text))),
    record(BRT.endSst),
  ]);
}

/** `BrtXF` (§2.4.876): the parent, the number format, then font, fill, border and alignment. */
function xf(parent: number, format: number): Uint8Array {
  return record(BRT.xf, u16(parent), u16(format), new Uint8Array(12));
}

function stylesPart(workbook: XlsbWorkbook): Uint8Array {
  const formats = workbook.formats ?? [];
  const xfs = workbook.xfs ?? [0];
  return concat([
    record(BRT.beginStyleSheet),
    record(BRT.beginFmts, u32(formats.length)),
    ...formats.map(([id, code]) => record(BRT.fmt, u16(id), wide(code))),
    record(BRT.endFmts),
    // A cell-style format first, as Excel writes it: a cell never indexes this list.
    record(BRT.beginCellStyleXFs, u32(1)),
    xf(0xff_ff, 14),
    record(BRT.endCellStyleXFs),
    record(BRT.beginCellXFs, u32(xfs.length)),
    ...xfs.map((format) => xf(0, format)),
    record(BRT.endCellXFs),
    record(BRT.endStyleSheet),
  ]);
}

function relationship(id: string, type: string, target: string): string {
  return `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`;
}

/** The workbook as an `.xlsb`: its parts in a zip, found through their relationships. */
export function xlsbOf(workbook: XlsbWorkbook): Uint8Array {
  const sheets = workbook.sheets.map((sheet, at) => ({
    id: `rId${String(at + 1)}`,
    target: `worksheets/sheet${String(at + 1)}.bin`,
    bytes: sheetPart(sheet),
  }));
  const related = [
    ...sheets.map((sheet) => relationship(sheet.id, "worksheet", sheet.target)),
    relationship("rIdShared", "sharedStrings", "sharedStrings.bin"),
    relationship("rIdStyles", "styles", "styles.bin"),
  ];
  return zipOf([
    {
      name: "[Content_Types].xml",
      body: `<Types><Override PartName="/xl/workbook.bin" ContentType="${MAIN}"/></Types>`,
    },
    {
      name: "_rels/.rels",
      body: `<Relationships>${relationship("rId1", "officeDocument", "xl/workbook.bin")}</Relationships>`,
    },
    { name: "xl/workbook.bin", body: workbookPart(workbook) },
    {
      name: "xl/_rels/workbook.bin.rels",
      body: `<Relationships>${related.join("")}</Relationships>`,
    },
    ...sheets.map((sheet) => ({ name: `xl/${sheet.target}`, body: sheet.bytes })),
    { name: "xl/sharedStrings.bin", body: sharedStringsPart(workbook.shared ?? []) },
    { name: "xl/styles.bin", body: stylesPart(workbook) },
  ]);
}

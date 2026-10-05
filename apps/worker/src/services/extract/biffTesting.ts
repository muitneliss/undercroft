/**
 * An Excel 97–2003 workbook, written the way Excel writes one: a `Workbook` stream of BIFF8
 * records -- the globals, then each sheet from its `BOF` to its `EOF` -- inside a compound file.
 *
 * The workbook half of `cfbTesting.ts`, as `biff8.ts` is the workbook half of the reader. It
 * writes only the records the reader reads ([MS-XLS] §2.4), with the layouts the spec gives them,
 * so a suite exercises the format rather than a stand-in for it. Nothing binary is committed.
 */

import { cfbOf } from "./cfbTesting.ts";
import { concat } from "./testing.ts";

/** One cell, by the record Excel would write for it. `xf` indexes the workbook's `xfs`. */
export type BiffCell = { readonly row: number; readonly col: number; readonly xf?: number } & (
  | { readonly sst: number }
  | { readonly label: string }
  | { readonly number: number }
  | { readonly rk: number }
  | { readonly bool: boolean }
  | { readonly error: number }
  | { readonly formulaNumber: number }
  | { readonly formulaString: string }
  | { readonly formulaError: number }
);

export interface BiffSheet {
  readonly name: string;
  /** 0 visible, 1 hidden, 2 very hidden. */
  readonly state?: number;
  readonly cells: readonly BiffCell[];
  readonly hiddenRows?: readonly number[];
  /** Zero-based `[firstRow, lastRow, firstCol, lastCol]`, as `MERGEDCELLS` stores them. */
  readonly merges?: readonly (readonly [number, number, number, number])[];
}

/** A shared string split across a `CONTINUE`: `head` compressed, `tail` re-flagged as wide. */
export interface SplitString {
  readonly head: string;
  readonly tail: string;
}

export interface BiffWorkbook {
  readonly sheets: readonly BiffSheet[];
  readonly shared?: readonly (string | SplitString)[];
  readonly date1904?: boolean;
  /** Custom number formats: `[id, code]`. */
  readonly formats?: readonly (readonly [number, string])[];
  /** Each XF's number-format id; a cell's `xf` indexes this list. */
  readonly xfs?: readonly number[];
  /** Write `FILEPASS`: the workbook was saved with a password. */
  readonly password?: boolean;
}

const TYPE = {
  bof: 0x08_09,
  eof: 0x00_0a,
  filePass: 0x00_2f,
  dateMode: 0x00_22,
  format: 0x04_1e,
  xf: 0x00_e0,
  boundSheet: 0x00_85,
  sst: 0x00_fc,
  continue: 0x00_3c,
  dimensions: 0x02_00,
  row: 0x02_08,
  labelSst: 0x00_fd,
  label: 0x02_04,
  number: 0x02_03,
  rk: 0x02_7e,
  boolErr: 0x02_05,
  formula: 0x00_06,
  string: 0x02_07,
  mergedCells: 0x00_e5,
} as const;

function u8(value: number): Uint8Array {
  // A Uint8Array keeps the low byte of what it is given.
  return Uint8Array.of(value);
}

function u16(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, true);
  return out;
}

function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

function f64(value: number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setFloat64(0, value, true);
  return out;
}

function record(type: number, ...data: readonly Uint8Array[]): Uint8Array {
  const body = concat(data);
  return concat([u16(type), u16(body.byteLength), body]);
}

function wide(text: string): boolean {
  return [...text].some((character) => (character.codePointAt(0) ?? 0) > 0xff);
}

/** Characters, one byte each when every one fits, else UTF-16LE. */
function characters(text: string, asWide: boolean): Uint8Array {
  if (!asWide) {
    return Uint8Array.from([...text].map((character) => character.codePointAt(0) ?? 0));
  }
  const out = new Uint8Array(text.length * 2);
  for (let at = 0; at < text.length; at += 1) {
    new DataView(out.buffer).setUint16(at * 2, text.charCodeAt(at), true);
  }
  return out;
}

function unicodeString(text: string): Uint8Array {
  const asWide = wide(text);
  return concat([u16(text.length), u8(asWide ? 1 : 0), characters(text, asWide)]);
}

function shortString(text: string): Uint8Array {
  const asWide = wide(text);
  return concat([u8(text.length), u8(asWide ? 1 : 0), characters(text, asWide)]);
}

/** The shared string table, and the `CONTINUE` a split string's tail starts. */
function sstRecords(shared: readonly (string | SplitString)[]): Uint8Array {
  const segments: Uint8Array[][] = [[u32(shared.length), u32(shared.length)]];
  for (const item of shared) {
    const current = segments.at(-1) ?? [];
    if (typeof item === "string") {
      current.push(unicodeString(item));
    } else {
      const count = item.head.length + item.tail.length;
      current.push(u16(count), u8(0), characters(item.head, false));
      // The continuation begins with the characters' flags again: here, two bytes each.
      segments.push([u8(1), characters(item.tail, true)]);
    }
  }
  return concat(segments.map((parts, at) => record(at === 0 ? TYPE.sst : TYPE.continue, ...parts)));
}

function cellRecords(cell: BiffCell): Uint8Array {
  const at = concat([u16(cell.row), u16(cell.col), u16(cell.xf ?? 0)]);
  if ("sst" in cell) {
    return record(TYPE.labelSst, at, u32(cell.sst));
  }
  if ("label" in cell) {
    return record(TYPE.label, at, unicodeString(cell.label));
  }
  if ("number" in cell) {
    return record(TYPE.number, at, f64(cell.number));
  }
  if ("rk" in cell) {
    return record(TYPE.rk, at, u32(cell.rk));
  }
  if ("bool" in cell) {
    return record(TYPE.boolErr, at, u8(cell.bool ? 1 : 0), u8(0));
  }
  if ("error" in cell) {
    return record(TYPE.boolErr, at, u8(cell.error), u8(1));
  }
  const tail = concat([u16(0), u32(0), u16(0)]);
  if ("formulaNumber" in cell) {
    return record(TYPE.formula, at, f64(cell.formulaNumber), tail);
  }
  if ("formulaError" in cell) {
    const result = Uint8Array.of(2, 0, cell.formulaError, 0, 0, 0, 0xff, 0xff);
    return record(TYPE.formula, at, result, tail);
  }
  const result = Uint8Array.of(0, 0, 0, 0, 0, 0, 0xff, 0xff);
  return concat([
    record(TYPE.formula, at, result, tail),
    record(TYPE.string, unicodeString(cell.formulaString)),
  ]);
}

function sheetStream(sheet: BiffSheet): Uint8Array {
  const rows = [...new Set(sheet.cells.map((cell) => cell.row))];
  const columns = sheet.cells.map((cell) => cell.col);
  const bounds = [
    u32(Math.min(...rows)),
    u32(Math.max(...rows) + 1),
    u16(Math.min(...columns)),
    u16(Math.max(...columns) + 1),
    u16(0),
  ];
  const rowRecords = rows.map((row) =>
    record(
      TYPE.row,
      u16(row),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u16((sheet.hiddenRows ?? []).includes(row) ? 0x20 : 0),
      u16(0),
    ),
  );
  const merges = sheet.merges ?? [];
  return concat([
    record(TYPE.bof, u16(0x06_00), u16(0x00_10), new Uint8Array(12)),
    record(TYPE.dimensions, ...bounds),
    ...rowRecords,
    ...sheet.cells.map(cellRecords),
    ...(merges.length === 0
      ? []
      : [record(TYPE.mergedCells, u16(merges.length), ...merges.flat().map(u16))]),
    record(TYPE.eof),
  ]);
}

function globals(workbook: BiffWorkbook, offsets: readonly number[]): Uint8Array {
  return concat([
    record(TYPE.bof, u16(0x06_00), u16(0x00_05), new Uint8Array(12)),
    ...(workbook.password === true ? [record(TYPE.filePass, u16(1), new Uint8Array(52))] : []),
    record(TYPE.dateMode, u16(workbook.date1904 === true ? 1 : 0)),
    ...(workbook.formats ?? []).map(([id, code]) =>
      record(TYPE.format, u16(id), unicodeString(code)),
    ),
    ...(workbook.xfs ?? [0]).map((format) =>
      record(TYPE.xf, u16(0), u16(format), new Uint8Array(16)),
    ),
    ...workbook.sheets.map((sheet, at) =>
      record(
        TYPE.boundSheet,
        u32(offsets[at] ?? 0),
        u8(sheet.state ?? 0),
        u8(0),
        shortString(sheet.name),
      ),
    ),
    sstRecords(workbook.shared ?? []),
    record(TYPE.eof),
  ]);
}

/** The workbook as an `.xls`: its `Workbook` stream inside a compound file. */
export function xlsOf(workbook: BiffWorkbook): Uint8Array {
  const sheets = workbook.sheets.map(sheetStream);
  const head = globals(
    workbook,
    sheets.map(() => 0),
  ).byteLength;
  const offsets = sheets.map((_, at) =>
    sheets.slice(0, at).reduce((total, sheet) => total + sheet.byteLength, head),
  );
  const stream = concat([globals(workbook, offsets), ...sheets]);
  return cfbOf([
    { name: "Root Entry", type: 5, child: 1 },
    { name: "Workbook", type: 2, bytes: stream },
  ]);
}

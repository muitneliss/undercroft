/**
 * How a BIFF12 record is written ([MS-XLSB] §2.1.4): its type and size as variable-length
 * integers, then its fields, little-endian. The primitives `xlsbTesting.ts` writes a workbook's
 * parts with.
 *
 * THE RECORD TYPES ARE WRITTEN OUT AGAIN HERE, not imported from the reader's `xlsbRecords.ts`.
 * A fixture that took its numbers from the code under test would agree with a wrong number, and
 * the suite would pass over a reader that reads nothing Excel writes.
 */

import { concat } from "./testing.ts";

export const BRT = {
  rowHdr: 0,
  cellBlank: 1,
  cellRk: 2,
  cellError: 3,
  cellBool: 4,
  cellReal: 5,
  cellSt: 6,
  cellIsst: 7,
  fmlaString: 8,
  fmlaNum: 9,
  fmlaBool: 10,
  fmlaError: 11,
  sstItem: 19,
  fmt: 44,
  xf: 47,
  cellRString: 62,
  beginSheet: 129,
  endSheet: 130,
  beginBook: 131,
  endBook: 132,
  beginBundleShs: 143,
  endBundleShs: 144,
  beginSheetData: 145,
  endSheetData: 146,
  wsDim: 148,
  wbProp: 153,
  bundleSh: 156,
  beginSst: 159,
  endSst: 160,
  mergeCell: 176,
  beginMergeCells: 177,
  endMergeCells: 178,
  beginStyleSheet: 278,
  endStyleSheet: 279,
  beginFmts: 615,
  endFmts: 616,
  beginCellXFs: 617,
  endCellXFs: 618,
  beginCellStyleXFs: 626,
  endCellStyleXFs: 627,
} as const;

const SEVEN_BITS = 128;

function bytesOf(width: number, write: (view: DataView) => void): Uint8Array {
  const out = new Uint8Array(width);
  write(new DataView(out.buffer));
  return out;
}

export function u8(value: number): Uint8Array {
  return Uint8Array.of(value);
}

export function u16(value: number): Uint8Array {
  return bytesOf(2, (view) => view.setUint16(0, value, true));
}

export function u32(value: number): Uint8Array {
  return bytesOf(4, (view) => view.setUint32(0, value, true));
}

export function f64(value: number): Uint8Array {
  return bytesOf(8, (view) => view.setFloat64(0, value, true));
}

/** An `XLWideString`: a 32-bit count of UTF-16 code units, then the units. */
export function wide(text: string): Uint8Array {
  const units = bytesOf(text.length * 2, (view) => {
    for (let at = 0; at < text.length; at += 1) {
      view.setUint16(at * 2, text.charCodeAt(at), true);
    }
  });
  return concat([u32(text.length), units]);
}

/** A record's type or size as the spec writes it: seven bits a byte, low first (§2.1.4). */
function varint(value: number): number[] {
  const out: number[] = [];
  let rest = value;
  do {
    const low = rest % SEVEN_BITS;
    rest = Math.floor(rest / SEVEN_BITS);
    out.push(rest > 0 ? low + SEVEN_BITS : low);
  } while (rest > 0);
  return out;
}

export function record(type: number, ...data: readonly Uint8Array[]): Uint8Array {
  const body = concat(data);
  return concat([Uint8Array.from([...varint(type), ...varint(body.byteLength)]), body]);
}

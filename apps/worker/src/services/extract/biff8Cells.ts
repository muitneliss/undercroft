/**
 * The cells a BIFF8 cell record states ([MS-XLS] §2.4): where each sits, its format index, and
 * what it holds -- a shared string, a label, a number, an `RK` run, a boolean, an error, or a
 * formula's cached result. `biff8.ts` places them in rows; `biff8Values.ts` renders the numbers.
 */

import { type BiffRecord, Cursor, RECORD } from "./biffRecords.ts";
import { doubleText, errorOf, rkText } from "./biff8Values.ts";
import { SHARED_STRING_MISSING } from "./sheetCells.ts";

const SPECIAL_BYTE = 0xff;
const RESULT = { string: 0, boolean: 1, error: 2, empty: 3 } as const;

/** One cell as a record states it: where, its format index, and what it holds. */
export interface Cell {
  readonly row: number;
  readonly column: number;
  readonly xf: number;
  readonly value: string | null;
  readonly fault: string | null;
}

/** A formula's cached result (§2.5.133): a double, or a string still to come, a boolean, an error. */
function formulaCell(cursor: Cursor, at: Omit<Cell, "value" | "fault">): Cell | "string-follows" {
  const result = cursor.bytes(8);
  // Not 0xFFFF in its last two bytes: the eight bytes are the double itself.
  if (result[6] !== SPECIAL_BYTE || result[7] !== SPECIAL_BYTE) {
    return { ...at, value: doubleText(result), fault: null };
  }
  switch (result[0]) {
    case RESULT.string:
      return "string-follows";
    case RESULT.boolean:
      return { ...at, value: result[2] === 0 ? "0" : "1", fault: null };
    case RESULT.error:
      return { ...at, value: null, fault: errorOf(result[2] ?? 0) };
    default:
      return { ...at, value: null, fault: null };
  }
}

/** The cells one record holds -- a `MULRK` holds several -- or a formula awaiting its string. */
export function cellsOf(
  record: BiffRecord,
  shared: readonly string[],
): Cell[] | { pending: Omit<Cell, "value" | "fault"> } {
  const cursor = new Cursor(record);
  if (record.type === RECORD.mulRk) {
    const row = cursor.uint16();
    const first = cursor.uint16();
    const count =
      (record.segments.reduce((total, segment) => total + segment.byteLength, 0) - 6) / 6;
    return Array.from({ length: count }, (_, offset) => {
      const xf = cursor.uint16();
      return { row, column: first + offset, xf, value: rkText(cursor.uint32()), fault: null };
    });
  }
  const at = { row: cursor.uint16(), column: cursor.uint16(), xf: cursor.uint16() };
  switch (record.type) {
    case RECORD.labelSst: {
      const text = shared[cursor.uint32()];
      return [
        text === undefined
          ? { ...at, value: null, fault: SHARED_STRING_MISSING }
          : { ...at, value: text, fault: null },
      ];
    }
    case RECORD.label:
    case RECORD.richLabel:
      return [{ ...at, value: cursor.string(), fault: null }];
    case RECORD.number:
      return [{ ...at, value: doubleText(cursor.bytes(8)), fault: null }];
    case RECORD.rk:
      return [{ ...at, value: rkText(cursor.uint32()), fault: null }];
    case RECORD.boolErr: {
      const value = cursor.byte();
      return [
        cursor.byte() === 0
          ? { ...at, value: value === 0 ? "0" : "1", fault: null }
          : { ...at, value: null, fault: errorOf(value) },
      ];
    }
    default: {
      const cell = formulaCell(cursor, at);
      return cell === "string-follows" ? { pending: at } : [cell];
    }
  }
}

export const CELL_RECORDS: ReadonlySet<number> = new Set([
  RECORD.labelSst,
  RECORD.label,
  RECORD.richLabel,
  RECORD.number,
  RECORD.rk,
  RECORD.mulRk,
  RECORD.boolErr,
  RECORD.formula,
]);
